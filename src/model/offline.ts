import { formatMoney } from '../money.js';
import {
  describeLimit,
  describeRegion,
  describeRule,
  informativeNotes,
  isGlobal,
  regionList,
  list,
  sentence,
  withArticle,
} from '../answer/describe.js';
import type { LanguageModel, ModelRequest, ModelResponse } from './types.js';

/**
 * The default model: a deterministic composer.
 *
 * It is called a model because it sits behind the same interface and does the
 * same job — turning a decision into English — and because swapping it for a
 * hosted one changes nothing else in the system. What it is not is a guess: the
 * same question always produces the same words, every sentence is traceable to
 * a rule, and it needs no key, no network and no download. That is what makes
 * the repository runnable by someone who has never seen it.
 */
export class OfflineModel implements LanguageModel {
  readonly id = 'offline';
  readonly description = 'Deterministic composer. No network, no credentials, no downloads.';

  async generate(request: ModelRequest): Promise<ModelResponse> {
    return { text: compose(request) };
  }
}

export function compose(request: ModelRequest): string {
  switch (request.retrieval.coverage) {
    case 'out_of_scope':
      return outOfScope(request);
    case 'not_covered':
      return notCovered(request);
    case 'covered':
      return covered(request);
  }
}

function outOfScope(request: ModelRequest): string {
  const { policy } = request;
  return [
    'That is not something this travel expense policy covers.',
    `The policy sets limits for ${list(policy.categories)} while travelling. Ask about one of those and I can quote the figure.`,
  ].join('\n');
}

function notCovered(request: ModelRequest): string {
  const { retrieval, analysis, policy } = request;
  const lines = ['The policy does not cover this.'];

  if (retrieval.unknownRegion) {
    const named = analysis.categories.length > 0 ? `${list(analysis.categories)} in ` : '';
    lines.push(
      `There is no rule for ${named}${retrieval.unknownRegion}. ` +
        `The regions in this policy are ${regionList(policy.regions)}.`,
    );
  } else if (retrieval.unmatchedCategories.length > 0) {
    for (const category of retrieval.unmatchedCategories) {
      const regions = policy.rules.filter((rule) => rule.category === category).map((rule) => rule.region);
      const where = analysis.regions.length > 0 ? ` ${describeRegion(analysis.regions[0]!)}` : '';
      lines.push(
        regions.length > 0
          ? `${category}${where} is not priced. The policy sets ${category} only for ${regionList(regions)}.`
          : `${category} does not appear in the policy at all.`,
      );
    }
  } else {
    lines.push(
      `It covers ${list(policy.categories)} only, for ${regionList(policy.regions)}.`,
    );
  }

  lines.push('Check with Finance before claiming it.');
  return lines.join('\n');
}

function covered(request: ModelRequest): string {
  const { verdict } = request;

  if (verdict) {
    switch (verdict.status) {
      case 'currency_not_supported':
        return currencyNotSupported(request);
      case 'no_cap':
        return noCap(request);
      case 'within_limit':
      case 'at_limit':
      case 'over_limit':
        return judged(request);
    }
  }

  return informational(request);
}

function currencyNotSupported(request: ModelRequest): string {
  const verdict = request.verdict!;
  const rule = verdict.rule;

  return [
    `The policy is written in ${rule.limit?.currency ?? 'USD'} and this assistant does not convert currencies.`,
    `${describeRule(rule)}. Convert your ${verdict.foreignCurrency} figure at the rate your finance team uses, then compare.`,
    ...noteLines(request),
  ].join('\n');
}

function noCap(request: ModelRequest): string {
  const rule = request.verdict!.rule;

  return [
    'No fixed limit.',
    `The policy sets no cap on ${rule.category.toLowerCase()} ${describeRegion(rule.region)}.`,
    ...noteLines(request),
  ].join('\n');
}

function judged(request: ModelRequest): string {
  const verdict = request.verdict!;
  const rule = verdict.rule;
  const claimed = formatMoney(verdict.claimed!);
  const headline =
    verdict.status === 'over_limit'
      ? 'Over the limit.'
      : verdict.status === 'at_limit'
        ? 'Exactly on the limit, which is allowed.'
        : 'Within policy.';

  const allowance = verdict.quantity
    ? `${describeRule(rule)}, so ${verdict.quantity.count} ${plural(verdict.quantity.unit, verdict.quantity.count)} allows ${formatMoney(verdict.limit!)}.`
    : `${describeRule(rule)}.`;

  const comparison =
    verdict.status === 'over_limit'
      ? `${claimed} is ${formatMoney(verdict.excess!)} over. The excess needs approval before it can be claimed.`
      : verdict.status === 'at_limit'
        ? `${claimed} sits on the limit.`
        : `${claimed} is inside it.`;

  return [headline, `${allowance} ${comparison}`, ...noteLines(request)].join('\n');
}

/** No sum of money to judge — the reader wants to know what the policy says. */
function informational(request: ModelRequest): string {
  const { retrieval, analysis } = request;
  const matches = retrieval.matches;

  if (matches.length === 1) {
    const match = matches[0]!;
    return [
      `${describeRule(match.rule)}.`,
      ...(match.viaGlobal ? [globalCaveat(match.rule.category, analysis.regions)] : []),
      ...noteLines(request),
    ]
      .filter(Boolean)
      .join('\n');
  }

  const heading = retrieval.isSummary
    ? `What the policy allows ${describeRegion(analysis.regions[0] ?? 'Global')}:`
    : 'What the policy allows:';

  const bullets = matches.map((match) => {
    const notes = informativeNotes(match.rule, analysis);
    const suffix = notes.length > 0 ? ` (${notes.map((note) => note.toLowerCase()).join('; ')})` : '';
    const worldwide = match.viaGlobal ? ' — a worldwide rule' : '';
    return `- ${match.rule.category} ${describeRegion(match.rule.region)}: ${describeLimit(match.rule)}${suffix}${worldwide}`;
  });

  return [heading, ...bullets].join('\n');
}

function globalCaveat(category: string, regions: readonly string[]): string {
  const asked = regions.find((region) => !isGlobal(region));
  return asked
    ? `The policy sets no ${category.toLowerCase()} rule specific to ${withArticle(asked)}; this is the worldwide rule.`
    : '';
}

function noteLines(request: ModelRequest): string[] {
  const rule = request.verdict?.rule ?? request.retrieval.matches[0]?.rule;
  if (!rule) return [];

  const notes = informativeNotes(rule, request.analysis);
  return notes.length > 0 ? [notes.map(sentence).join(' ')] : [];
}

function plural(unit: string, count: number): string {
  return count === 1 ? unit : `${unit}s`;
}
