import { readFile } from 'node:fs/promises';

import { buildVerdict, type Verdict } from './answer/verdict.js';
import { readConfig, type Config, type ConfigOverrides } from './config.js';
import { createModel } from './model/index.js';
import type { LanguageModel } from './model/types.js';
import { loadPolicy } from './policy/load.js';
import type { Policy } from './policy/types.js';
import { analyseQuestion, type QuestionAnalysis } from './retrieval/question.js';
import { retrieve, type Coverage, type Retrieval } from './retrieval/retrieve.js';

export interface Citation {
  readonly rule: string;
  readonly category: string;
  readonly region: string;
  /** Line numbers in the source file, so a reader can go and check. */
  readonly lines: readonly number[];
}

export interface Answer {
  readonly question: string;
  /** The prose answer, written by whichever model is configured. */
  readonly text: string;
  /**
   * Whether the policy addresses the question. Present on every answer, and
   * decided in code, so a caller can act on it without parsing English.
   */
  readonly coverage: Coverage;
  /** The decision, where one was called for. */
  readonly verdict: Verdict | null;
  readonly citations: readonly Citation[];
  readonly provider: string;
  readonly policySource: string;
}

export class PolicyFileError extends Error {
  override readonly name = 'PolicyFileError';
}

/**
 * The whole assistant: a policy, a model, and one method.
 *
 * The pipeline is analyse -> retrieve -> decide -> phrase, and only the last
 * step is the model's. Everything a caller needs to trust the answer —
 * coverage, the verdict, the lines of the CSV it came from — is computed before
 * the model is asked for a single word.
 */
export class PolicyAssistant {
  constructor(
    readonly policy: Policy,
    private readonly model: LanguageModel,
  ) {}

  static async create(overrides: ConfigOverrides = {}, env: NodeJS.ProcessEnv = process.env): Promise<PolicyAssistant> {
    const config = readConfig(env, overrides);
    return PolicyAssistant.fromConfig(config);
  }

  static async fromConfig(config: Config): Promise<PolicyAssistant> {
    return new PolicyAssistant(await readPolicyFile(config.policyFile), createModel(config));
  }

  async ask(question: string, signal?: AbortSignal): Promise<Answer> {
    const analysis: QuestionAnalysis = analyseQuestion(question, this.policy);
    const retrieval: Retrieval = retrieve(this.policy, analysis);
    const verdict = buildVerdict(retrieval, analysis);

    const { text } = await this.model.generate(
      { question, analysis, retrieval, verdict, policy: this.policy },
      signal,
    );

    return {
      question,
      text,
      coverage: retrieval.coverage,
      verdict,
      citations: retrieval.matches.map((match) => ({
        rule: match.rule.id,
        category: match.rule.category,
        region: match.rule.region,
        lines: match.rule.sourceLines,
      })),
      provider: this.model.id,
      policySource: this.policy.source,
    };
  }
}

export async function readPolicyFile(path: string): Promise<Policy> {
  let text: string;

  try {
    text = await readFile(path, 'utf8');
  } catch (cause) {
    throw new PolicyFileError(
      `Could not read the policy file at ${path}. ` +
        'Pass --policy <path>, or set POLICY_FILE, to point at a different one.',
      { cause },
    );
  }

  return loadPolicy(text, path);
}
