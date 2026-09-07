import { multiplyMoney, subtractMoney, type Money } from '../money.js';
import type { PolicyRule } from '../policy/types.js';
import type { QuestionAnalysis, Quantity } from '../retrieval/question.js';
import type { Retrieval } from '../retrieval/retrieve.js';

export type VerdictStatus =
  /** The claim is under the limit. */
  | 'within_limit'
  /** Exactly on the limit, which the policy allows. */
  | 'at_limit'
  /** Over. */
  | 'over_limit'
  /** The policy sets no number for this, so the claim is judged on its own merits. */
  | 'no_cap'
  /** The user named a currency the policy is not written in. */
  | 'currency_not_supported';

export interface Verdict {
  readonly status: VerdictStatus;
  readonly rule: PolicyRule;
  /** The limit the claim was judged against, already multiplied by any nights. */
  readonly limit: Money | null;
  readonly claimed: Money | null;
  /** How far over the limit the claim is. Only set for `over_limit`. */
  readonly excess: Money | null;
  readonly quantity: Quantity | null;
  readonly foreignCurrency: string | null;
}

/**
 * The decision, made in code.
 *
 * This is the part of the answer that must not be left to a language model.
 * Whichever model phrases the reply is handed this object and asked to say it
 * in English; the arithmetic, the comparison and the "we do not do FX" refusal
 * have already happened, identically in every mode.
 *
 * Returns null when the question did not ask for a judgement — no sum of money
 * named, or several rules in play and no way to know which one the sum belongs
 * to. Guessing there would be worse than staying quiet.
 */
export function buildVerdict(retrieval: Retrieval, analysis: QuestionAnalysis): Verdict | null {
  const rule = soleComparableRule(retrieval);
  if (!rule) return null;

  if (analysis.foreignCurrency) {
    return {
      status: 'currency_not_supported',
      rule,
      limit: rule.limit,
      claimed: null,
      excess: null,
      quantity: analysis.quantity,
      foreignCurrency: analysis.foreignCurrency,
    };
  }

  if (!rule.limit) {
    return {
      status: 'no_cap',
      rule,
      limit: null,
      claimed: analysis.amount,
      excess: null,
      quantity: analysis.quantity,
      foreignCurrency: null,
    };
  }

  if (!analysis.amount) return null;

  if (analysis.amount.currency !== rule.limit.currency) {
    return {
      status: 'currency_not_supported',
      rule,
      limit: rule.limit,
      claimed: analysis.amount,
      excess: null,
      quantity: analysis.quantity,
      foreignCurrency: analysis.amount.currency,
    };
  }

  // "USD 220 per night" against a three-night stay is a USD 660 allowance. The
  // multiplied figure is what the answer shows its working for.
  const applyQuantity = analysis.quantity !== null && rule.basis !== null;
  const limit = applyQuantity ? multiplyMoney(rule.limit, analysis.quantity!.count) : rule.limit;

  const status: VerdictStatus =
    analysis.amount.minor < limit.minor ? 'within_limit' : analysis.amount.minor === limit.minor ? 'at_limit' : 'over_limit';

  return {
    status,
    rule,
    limit,
    claimed: analysis.amount,
    excess: status === 'over_limit' ? subtractMoney(analysis.amount, limit) : null,
    quantity: applyQuantity ? analysis.quantity : null,
    foreignCurrency: null,
  };
}

/**
 * A judgement needs one rule to judge against. With several matches the sum is
 * ambiguous — "meals and hotel in Dubai, is $95 fine?" could mean either — with
 * one exception: if only one of the matched rules carries a number, that is
 * unambiguously the one the number is about.
 */
function soleComparableRule(retrieval: Retrieval): PolicyRule | null {
  if (retrieval.coverage !== 'covered') return null;

  const rules = retrieval.matches.map((match) => match.rule);
  if (rules.length === 1) return rules[0]!;

  const categories = new Set(rules.map((rule) => rule.category));
  if (categories.size > 1) {
    const withLimit = rules.filter((rule) => rule.limit !== null);
    return withLimit.length === 1 ? withLimit[0]! : null;
  }

  // One category across several regions: still ambiguous.
  return null;
}
