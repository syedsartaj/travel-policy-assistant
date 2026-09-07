import type { Verdict } from '../answer/verdict.js';
import type { Policy } from '../policy/types.js';
import type { QuestionAnalysis } from '../retrieval/question.js';
import type { Retrieval } from '../retrieval/retrieve.js';

/**
 * Everything a model is allowed to know when it writes the answer.
 *
 * Note what is here and what is not. The rules are the retrieved ones, never
 * the whole policy plus a hope; the verdict is already decided; and there is no
 * conversation history or outside context. A model given this can phrase an
 * answer, and cannot invent a limit — which is the point of the split.
 */
export interface ModelRequest {
  readonly question: string;
  readonly analysis: QuestionAnalysis;
  readonly retrieval: Retrieval;
  readonly verdict: Verdict | null;
  readonly policy: Policy;
}

export interface ModelResponse {
  readonly text: string;
}

/**
 * The seam between the assistant and whatever writes its prose.
 *
 * One method, no lifecycle, no streaming. A second implementation costs about
 * forty lines (see anthropic.ts), and the default one needs no network, no
 * credentials and no downloads, so the whole thing runs on a laptop with the
 * wifi off.
 */
export interface LanguageModel {
  /** Stable identifier reported in `--json` output, e.g. "offline". */
  readonly id: string;
  /** One line for `--help` and for the JSON envelope. */
  readonly description: string;
  generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse>;
}

/** The model was asked for but is not usable — almost always a missing key. */
export class ModelConfigurationError extends Error {
  override readonly name = 'ModelConfigurationError';
}

/** The model was reachable but the call failed. */
export class ModelRequestError extends Error {
  override readonly name = 'ModelRequestError';
}
