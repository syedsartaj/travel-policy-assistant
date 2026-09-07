import { createInterface } from 'node:readline/promises';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { stdin, stdout } from 'node:process';

import { PolicyAssistant, type Answer } from './assistant.js';
import { readConfig, type ProviderName } from './config.js';
import type { Diagnostic } from './policy/types.js';

const USAGE = `travel-policy-assistant — answers questions from a travel expense policy.

  npm start -- "Can I expense a $95 dinner in Dubai?"
  npm start                       ask questions interactively

Options
  --provider <offline|anthropic>  which model writes the answer (default: offline)
  --policy <path>                 use a different policy CSV
  --json                          machine-readable output
  --diagnostics                   show what loading the policy file decided
  -h, --help                      this message

The offline provider is the default and needs no key, no account and no network.
Set ANTHROPIC_API_KEY in the environment to use --provider anthropic.`;

export async function main(argv: readonly string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: {
        json: { type: 'boolean', default: false },
        diagnostics: { type: 'boolean', default: false },
        provider: { type: 'string' },
        policy: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: true,
    });
  } catch (error) {
    process.stderr.write(`${describeError(error)}\n\n${USAGE}\n`);
    return 2;
  }

  const { values, positionals } = parsed;

  if (values.help) {
    stdout.write(`${USAGE}\n`);
    return 0;
  }

  const provider = readProvider(values.provider);
  if (provider instanceof Error) {
    process.stderr.write(`${provider.message}\n`);
    return 2;
  }

  let assistant: PolicyAssistant;
  try {
    const config = readConfig(process.env, { provider, policyFile: values.policy });
    assistant = await PolicyAssistant.fromConfig(config);
  } catch (error) {
    process.stderr.write(`${describeError(error)}\n`);
    return 1;
  }

  if (values.diagnostics) {
    writeDiagnostics(assistant.policy.diagnostics, assistant.policy.source);
  }

  const question = positionals.join(' ').trim();

  if (question === '') {
    return stdin.isTTY ? repl(assistant, values.json) : usageOnly(values.diagnostics);
  }

  try {
    const answer = await assistant.ask(question);
    stdout.write(values.json ? `${JSON.stringify(answer, null, 2)}\n` : `${render(answer)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${describeError(error)}\n`);
    return 1;
  }
}

function usageOnly(printedDiagnostics: boolean): number {
  // Piped input with no question: say how to use it rather than hanging on a
  // prompt nobody is there to answer.
  if (!printedDiagnostics) stdout.write(`${USAGE}\n`);
  return 0;
}

async function repl(assistant: PolicyAssistant, json: boolean): Promise<number> {
  const rl = createInterface({ input: stdin, output: stdout });
  stdout.write(
    `Ask about the travel expense policy (${basename(assistant.policy.source)}). Blank line or Ctrl-C to quit.\n\n`,
  );

  try {
    for (;;) {
      const question = (await rl.question('> ')).trim();
      if (question === '' || question === 'exit' || question === 'quit') return 0;

      try {
        const answer = await assistant.ask(question);
        stdout.write(`\n${json ? JSON.stringify(answer, null, 2) : render(answer)}\n\n`);
      } catch (error) {
        stdout.write(`\n${describeError(error)}\n\n`);
      }
    }
  } catch {
    // Ctrl-C or a closed stream during the prompt.
    return 0;
  } finally {
    rl.close();
  }
}

function render(answer: Answer): string {
  const lines = [answer.text];

  if (answer.citations.length > 0) {
    const source = basename(answer.policySource);
    const cited = answer.citations
      .map((citation) => `${citation.category} / ${citation.region} (line${citation.lines.length > 1 ? 's' : ''} ${citation.lines.join(', ')})`)
      .join('; ');
    lines.push('', dim(`Source: ${source} — ${cited}`));
  } else {
    lines.push('', dim(`Source: ${basename(answer.policySource)} — no matching rule`));
  }

  return lines.join('\n');
}

function writeDiagnostics(diagnostics: readonly Diagnostic[], source: string): void {
  if (diagnostics.length === 0) {
    stdout.write(dim(`${basename(source)}: loaded with nothing to report.\n\n`));
    return;
  }

  stdout.write(dim(`${basename(source)}:\n`));
  for (const diagnostic of diagnostics) {
    stdout.write(dim(`  [${diagnostic.level}] ${diagnostic.message}\n`));
  }
  stdout.write('\n');
}

function readProvider(value: string | undefined): ProviderName | undefined | Error {
  if (value === undefined) return undefined;
  if (value === 'offline' || value === 'anthropic') return value;
  return new Error(`--provider must be "offline" or "anthropic", not "${value}".`);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function dim(text: string): string {
  return stdout.isTTY ? `\u001b[2m${text}\u001b[0m` : text;
}

const entry = process.argv[1];
const isEntrypoint = entry !== undefined && import.meta.url === pathToFileURL(entry).href;

if (isEntrypoint) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`${describeError(error)}\n`);
      process.exitCode = 1;
    },
  );
}
