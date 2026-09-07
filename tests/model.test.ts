import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { buildVerdict } from '../src/answer/verdict.js';
import { BUNDLED_POLICY_FILE, ConfigurationError, readConfig } from '../src/config.js';
import { AnthropicModel, buildSystemPrompt } from '../src/model/anthropic.js';
import { createModel } from '../src/model/index.js';
import { ModelConfigurationError, ModelRequestError, type ModelRequest } from '../src/model/types.js';
import { loadPolicy } from '../src/policy/load.js';
import { analyseQuestion } from '../src/retrieval/question.js';
import { retrieve } from '../src/retrieval/retrieve.js';

const policy = loadPolicy(readFileSync(BUNDLED_POLICY_FILE, 'utf8'), 'travel_expense_policy.csv');

function request(question: string): ModelRequest {
  const analysis = analyseQuestion(question, policy);
  const retrieval = retrieve(policy, analysis);
  return { question, analysis, retrieval, verdict: buildVerdict(retrieval, analysis), policy };
}

function respondWith(body: unknown, status = 200): { fetchImpl: typeof fetch; calls: Request[] } {
  const calls: Request[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    calls.push(new Request(input as string, init));
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  return { fetchImpl, calls };
}

describe('readConfig', () => {
  it('runs offline with an empty environment, which is the case that must work', () => {
    const config = readConfig({});

    expect(config.provider).toBe('offline');
    expect(config.anthropicApiKey).toBeNull();
    expect(config.policyFile).toBe(BUNDLED_POLICY_FILE);
  });

  it('reads credentials from the environment and nowhere else', () => {
    expect(readConfig({ ANTHROPIC_API_KEY: 'sk-test' }).anthropicApiKey).toBe('sk-test');
    expect(readConfig({ ANTHROPIC_API_KEY: '   ' }).anthropicApiKey).toBeNull();
  });

  it('rejects a provider it does not know instead of falling back quietly', () => {
    expect(() => readConfig({ MODEL_PROVIDER: 'llama' })).toThrow(ConfigurationError);
  });
});

describe('createModel', () => {
  it('gives the offline model by default', () => {
    expect(createModel(readConfig({})).id).toBe('offline');
  });

  it('refuses the hosted model without a key, and says what to do about it', () => {
    const config = readConfig({ MODEL_PROVIDER: 'anthropic' });

    expect(() => createModel(config)).toThrow(ModelConfigurationError);
    expect(() => createModel(config)).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('does not silently answer from a different model than the one asked for', () => {
    // The alternative — quietly using offline when the key is missing — is the
    // kind of surprise that costs somebody an afternoon.
    expect(() => createModel(readConfig({ MODEL_PROVIDER: 'anthropic' }))).toThrow();
  });
});

describe('the hosted model', () => {
  it('is grounded: the prompt holds the retrieved rules and nothing else', () => {
    const prompt = buildSystemPrompt(request('What is the meal limit in Dubai?'));

    expect(prompt).toContain('USD 90.00 per day');
    // The other regions' limits are not in the prompt, so they cannot be quoted.
    expect(prompt).not.toContain('USD 75.00');
    expect(prompt).not.toContain('USD 40.00');
  });

  it('tells the model plainly when the policy has no rule', () => {
    const prompt = buildSystemPrompt(request('Can I claim a taxi in India?'));

    expect(prompt).toContain('(none: the policy has no rule covering this question)');
    expect(prompt).toContain('COVERAGE, already determined: not_covered');
  });

  it('hands over a decision that has already been made', () => {
    const prompt = buildSystemPrompt(request('Can I expense a $95 dinner in Dubai?'));

    expect(prompt).toContain('DECISION, already determined: the claim of USD 95.00 is over');
  });

  it('sends the key as a header and the question as the message', async () => {
    const { fetchImpl, calls } = respondWith({ content: [{ type: 'text', text: 'Over the limit.' }] });
    const model = new AnthropicModel({ apiKey: 'sk-test', model: 'claude-sonnet-5', fetchImpl });

    const response = await model.generate(request('Can I expense a $95 dinner in Dubai?'));

    expect(response.text).toBe('Over the limit.');
    expect(calls[0]?.headers.get('x-api-key')).toBe('sk-test');
    expect(calls[0]?.headers.get('anthropic-version')).toBe('2023-06-01');

    const body = (await calls[0]!.json()) as { model: string; messages: Array<{ content: string }> };
    expect(body.model).toBe('claude-sonnet-5');
    expect(body.messages[0]?.content).toBe('Can I expense a $95 dinner in Dubai?');
  });

  it('reports a failed call instead of returning an empty answer', async () => {
    const { fetchImpl } = respondWith({ error: 'unauthorised' }, 401);
    const model = new AnthropicModel({ apiKey: 'sk-bad', model: 'claude-sonnet-5', fetchImpl });

    await expect(model.generate(request('meals in India'))).rejects.toThrow(ModelRequestError);
  });

  it('cannot be built without a key', () => {
    expect(() => new AnthropicModel({ apiKey: '', model: 'claude-sonnet-5' })).toThrow(ModelConfigurationError);
  });
});
