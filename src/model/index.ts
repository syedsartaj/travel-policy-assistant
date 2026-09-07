import type { Config } from '../config.js';
import { AnthropicModel } from './anthropic.js';
import { OfflineModel } from './offline.js';
import { ModelConfigurationError, type LanguageModel } from './types.js';

export { AnthropicModel } from './anthropic.js';
export { OfflineModel, compose } from './offline.js';
export * from './types.js';

/**
 * Chooses the model. Offline is the default and is chosen when nothing is
 * configured, which is the case that has to work for a reviewer with no
 * account: `git clone && npm install && npm start` and it answers.
 *
 * Asking for a hosted model without a key is an error rather than a silent
 * fallback. Quietly answering from a different model than the one requested is
 * the kind of surprise that costs someone an afternoon.
 */
export function createModel(config: Config): LanguageModel {
  if (config.provider === 'offline') return new OfflineModel();

  if (!config.anthropicApiKey) {
    throw new ModelConfigurationError(
      'MODEL_PROVIDER=anthropic needs ANTHROPIC_API_KEY in the environment. ' +
        'Run without it, or with --provider offline, for the offline model.',
    );
  }

  return new AnthropicModel({ apiKey: config.anthropicApiKey, model: config.anthropicModel });
}
