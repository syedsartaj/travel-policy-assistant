import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PolicyAssistant } from '../src/assistant.js';
import { createServer } from '../src/server.js';

let server: Server;
let origin: string;

beforeAll(async () => {
  server = createServer(await PolicyAssistant.create({}, {}));
  // Port 0: the OS picks a free one, so the suite cannot collide with a
  // server the developer already has running.
  await new Promise<void>((resolve) => server.listen(0, resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const ask = async (question: string) =>
  (await fetch(`${origin}/api/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question }),
  })).json() as Promise<{ coverage: string; text: string; citations: unknown[] }>;

describe('the http surface', () => {
  it('serves the page', async () => {
    const response = await fetch(`${origin}/`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('Travel policy assistant');
  });

  it('answers a question and rules on it', async () => {
    const answer = await ask('Can I expense a $95 dinner in Dubai?');

    expect(answer.coverage).toBe('covered');
    expect(answer.text).toContain('USD 5.00 over');
  });

  it('says when the policy does not cover the question', async () => {
    const answer = await ask('Can I claim a taxi in India?');

    expect(answer.coverage).toBe('not_covered');
    expect(answer.citations).toEqual([]);
  });

  it('accepts a GET too, for curl', async () => {
    const response = await fetch(`${origin}/api/ask?q=${encodeURIComponent('meals in India')}`);

    expect((await response.json() as { text: string }).text).toContain('USD 40.00');
  });

  it('asks for a question rather than answering an empty one', async () => {
    const response = await fetch(`${origin}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
  });

  it('rejects a body that is not JSON instead of guessing', async () => {
    const response = await fetch(`${origin}/api/ask`, { method: 'POST', body: 'question=hello' });

    expect(response.status).toBe(500);
    expect((await response.json() as { error: string }).error).toContain('must be JSON');
  });

  it('reports health and the loaded policy', async () => {
    expect(await (await fetch(`${origin}/health`)).json()).toEqual({ ok: true, rules: 11 });

    const policy = await (await fetch(`${origin}/api/policy`)).json() as { provider: string; rules: unknown[] };
    expect(policy.provider).toBe('offline');
    expect(policy.rules).toHaveLength(11);
  });

  it('404s an unknown route', async () => {
    expect((await fetch(`${origin}/nope`)).status).toBe(404);
  });
});
