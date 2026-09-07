/**
 * Public surface, for using the assistant as a library rather than a CLI.
 *
 *   const assistant = await PolicyAssistant.create();
 *   const answer = await assistant.ask('Can I expense a $95 dinner in Dubai?');
 *   answer.coverage; // 'covered'
 */

export { PolicyAssistant, PolicyFileError, readPolicyFile, type Answer, type Citation } from './assistant.js';
export { buildVerdict, type Verdict, type VerdictStatus } from './answer/verdict.js';
export {
  BUNDLED_POLICY_FILE,
  ConfigurationError,
  readConfig,
  type Config,
  type ConfigOverrides,
  type ProviderName,
} from './config.js';
export { formatMoney, money, parseDecimalToMinor, type Money } from './money.js';
export { AnthropicModel, OfflineModel, compose, createModel } from './model/index.js';
export {
  ModelConfigurationError,
  ModelRequestError,
  type LanguageModel,
  type ModelRequest,
  type ModelResponse,
} from './model/types.js';
export { loadPolicy, PolicyFormatError } from './policy/load.js';
export { parseCsv, type CsvDocument, type CsvRow } from './policy/csv.js';
export type { Diagnostic, LimitBasis, Policy, PolicyRule } from './policy/types.js';
export { analyseQuestion, type QuestionAnalysis, type Quantity } from './retrieval/question.js';
export { retrieve, type Coverage, type Match, type Retrieval } from './retrieval/retrieve.js';
