import { fileURLToPath } from 'node:url';

export type ProviderName = 'offline' | 'anthropic';

export interface Config {
  readonly provider: ProviderName;
  /** Never logged, never written anywhere, never included in output. */
  readonly anthropicApiKey: string | null;
  readonly anthropicModel: string;
  readonly policyFile: string;
}

/**
 * The policy that ships with the repository. Resolved from this module rather
 * than from the working directory, so `npm start` works from anywhere and the
 * built output in dist/ finds the same file.
 */
export const BUNDLED_POLICY_FILE = fileURLToPath(new URL('../data/travel_expense_policy.csv', import.meta.url));

const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5';

export class ConfigurationError extends Error {
  override readonly name = 'ConfigurationError';
}

export interface ConfigOverrides {
  readonly provider?: ProviderName | undefined;
  readonly policyFile?: string | undefined;
}

/**
 * Reads configuration from the environment, with command-line overrides on top.
 *
 * Every value has a working default, and the default provider needs no
 * credentials at all — running the project must not require setting anything
 * up. Secrets are only ever read from the environment; there is no key file and
 * nothing is committed.
 */
export function readConfig(env: NodeJS.ProcessEnv = process.env, overrides: ConfigOverrides = {}): Config {
  const provider = overrides.provider ?? parseProvider(env['MODEL_PROVIDER']);
  const apiKey = (env['ANTHROPIC_API_KEY'] ?? '').trim();

  return {
    provider,
    anthropicApiKey: apiKey === '' ? null : apiKey,
    anthropicModel: (env['ANTHROPIC_MODEL'] ?? '').trim() || DEFAULT_ANTHROPIC_MODEL,
    policyFile: overrides.policyFile ?? ((env['POLICY_FILE'] ?? '').trim() || BUNDLED_POLICY_FILE),
  };
}

function parseProvider(value: string | undefined): ProviderName {
  const name = (value ?? '').trim().toLowerCase();
  if (name === '' || name === 'offline') return 'offline';
  if (name === 'anthropic') return 'anthropic';

  throw new ConfigurationError(`MODEL_PROVIDER must be "offline" or "anthropic", not "${value}".`);
}
