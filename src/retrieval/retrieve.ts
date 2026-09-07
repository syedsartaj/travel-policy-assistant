import type { Policy, PolicyRule } from '../policy/types.js';
import type { QuestionAnalysis } from './question.js';

/** How well the policy answers the question. */
export type Coverage =
  /** The policy has a rule for this. */
  | 'covered'
  /** A fair expenses question that this policy simply does not address. */
  | 'not_covered'
  /** Not a question about this travel policy at all. */
  | 'out_of_scope';

export interface Match {
  readonly rule: PolicyRule;
  /**
   * True when the rule was found under the "Global" region because the
   * question's own region has no rule of its own. Worth telling the reader:
   * they asked about Dubai and got a worldwide rule.
   */
  readonly viaGlobal: boolean;
}

export interface Retrieval {
  readonly coverage: Coverage;
  readonly matches: readonly Match[];
  /**
   * Categories the question named that the policy prices nowhere — the reason a
   * "not covered" answer can say exactly what is missing.
   */
  readonly unmatchedCategories: readonly string[];
  /** A place the question named that the policy has no rules for. */
  readonly unknownRegion: string | null;
  /** True when the question named no category, so the answer is a summary. */
  readonly isSummary: boolean;
}

const GLOBAL_REGION = 'global';

/**
 * Finds the rules that bear on a question.
 *
 * All of the retrieval happens here, in ordinary code, and the same result is
 * handed to whichever model phrases the answer. That is what stops a model —
 * offline or hosted — from answering out of its own head: it never sees a rule
 * that is not in the policy, and it is told when there are none.
 */
export function retrieve(policy: Policy, analysis: QuestionAnalysis): Retrieval {
  const regions = analysis.regions.length > 0 ? analysis.regions : null;
  const unknownRegion = analysis.unknownRegion;

  // A place the policy has never heard of. Answering from another region's
  // rules would be a confident wrong answer, so nothing matches on purpose.
  if (!regions && unknownRegion) {
    return {
      coverage: 'not_covered',
      matches: [],
      unmatchedCategories: analysis.categories,
      unknownRegion,
      isSummary: false,
    };
  }

  // No category named. "How much can I spend in Dubai?" is a real question and
  // the useful answer is everything the policy says about the UAE — but only
  // when the question was that broad. "Can I claim the train to Manchester?"
  // names something specific that the policy is silent on, and answering it
  // with a list of hotel and meal limits would dodge the question.
  if (analysis.categories.length === 0) {
    if (!regions || !analysis.isBroadQuestion) {
      return {
        coverage: analysis.isExpenseQuestion ? 'not_covered' : 'out_of_scope',
        matches: [],
        unmatchedCategories: [],
        unknownRegion: null,
        isSummary: false,
      };
    }

    const matches = policy.rules
      .filter((rule) => regions.some((region) => sameRegion(rule.region, region)) || isGlobal(rule.region))
      .map((rule) => ({ rule, viaGlobal: isGlobal(rule.region) && !regions.some(isGlobal) }));

    return {
      coverage: matches.length > 0 ? 'covered' : 'not_covered',
      matches,
      unmatchedCategories: [],
      unknownRegion: null,
      isSummary: true,
    };
  }

  const matches: Match[] = [];
  const unmatchedCategories: string[] = [];

  for (const category of analysis.categories) {
    const inCategory = policy.rules.filter((rule) => rule.category === category);

    // No region named: show every region the policy prices this category for.
    if (!regions) {
      if (inCategory.length > 0) matches.push(...inCategory.map((rule) => ({ rule, viaGlobal: false })));
      else unmatchedCategories.push(category);
      continue;
    }

    const direct = inCategory.filter((rule) => regions.some((region) => sameRegion(rule.region, region)));
    if (direct.length > 0) {
      matches.push(...direct.map((rule) => ({ rule, viaGlobal: false })));
      continue;
    }

    // "Global" is the policy's own fallback region: an Airfare question about
    // London is answered by the worldwide Airfare rules. It is only a fallback,
    // never an override — a region with its own rule always wins above.
    const global = inCategory.filter((rule) => isGlobal(rule.region));
    if (global.length > 0) {
      matches.push(...global.map((rule) => ({ rule, viaGlobal: true })));
      continue;
    }

    unmatchedCategories.push(category);
  }

  return {
    coverage: matches.length > 0 ? 'covered' : 'not_covered',
    matches,
    unmatchedCategories,
    unknownRegion: null,
    isSummary: false,
  };
}

function isGlobal(region: string): boolean {
  return region.toLowerCase() === GLOBAL_REGION;
}

function sameRegion(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
