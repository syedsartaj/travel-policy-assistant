import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { PolicyAssistant } from './assistant.js';
import { readConfig } from './config.js';

/**
 * A small HTTP surface over the same assistant the CLI uses.
 *
 * Built on node:http so the zero-dependency promise holds all the way to the
 * browser. It is deliberately thin: no sessions, no state, no framework. The
 * assistant is already a library returning a structured `Answer`, so the server
 * is little more than routing and JSON.
 */

const PAGE = fileURLToPath(new URL('../public/index.html', import.meta.url));
const MAX_BODY_BYTES = 8 * 1024;

export function createServer(assistant: PolicyAssistant): Server {
  return createHttpServer((request, response) => {
    handle(assistant, request, response).catch((error: unknown) => {
      send(response, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });
}

async function handle(assistant: PolicyAssistant, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const route = `${request.method} ${url.pathname}`;

  if (route === 'GET /health') {
    return send(response, 200, { ok: true, rules: assistant.policy.rules.length });
  }

  if (route === 'GET /api/policy') {
    return send(response, 200, {
      source: assistant.policy.source.split('/').pop(),
      provider: assistant.provider,
      rules: assistant.policy.rules,
      diagnostics: assistant.policy.diagnostics,
    });
  }

  // POST for the page, GET for curl. Same answer either way.
  if (route === 'POST /api/ask' || route === 'GET /api/ask') {
    const question =
      request.method === 'GET' ? (url.searchParams.get('q') ?? '') : await readQuestion(request);

    if (question.trim() === '') {
      return send(response, 400, { error: 'Ask a question: POST {"question": "..."} or GET /api/ask?q=...' });
    }

    return send(response, 200, await assistant.ask(question));
  }

  if (route === 'GET /') {
    const html = await readFile(PAGE, 'utf8');
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
    return;
  }

  send(response, 404, { error: `No route for ${route}.` });
}

/** Bounded, so a large body cannot be used to exhaust memory. */
async function readQuestion(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body too large.');
    chunks.push(chunk as Buffer);
  }

  const body = Buffer.concat(chunks).toString('utf8');
  if (body.trim() === '') return '';

  try {
    const parsed = JSON.parse(body) as { question?: unknown };
    return typeof parsed.question === 'string' ? parsed.question : '';
  } catch {
    throw new Error('Body must be JSON: {"question": "..."}');
  }
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body, null, 2));
}

export async function start(port = Number(process.env['PORT'] ?? 3000)): Promise<Server> {
  const assistant = await PolicyAssistant.fromConfig(readConfig());
  const server = createServer(assistant);

  await new Promise<void>((resolve) => server.listen(port, resolve));
  process.stdout.write(`Travel policy assistant on http://localhost:${port}\n`);

  return server;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  await start();
}
