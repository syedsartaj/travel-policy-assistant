import type { Money } from '../money.js';

/**
 * Categories and regions are NOT an enum. They are whatever the policy file
 * says they are, so a different CSV — more regions, a new expense category —
 * works without touching the code. The alias tables in src/retrieval are the
 * only place that knows "Dubai" means the UAE, and they are additive: an
 * unrecognised category still matches on its literal name.
 */

/** What a limit is measured against, read from the notes column. */
export type LimitBasis = 'per day' | 'per night';

export interface PolicyRule {
  /** Stable slug, e.g. "meals:united-kingdom". Used for citations. */
  readonly id: string;
  /** Exactly as written in the file, so answers quote the policy's own words. */
  readonly category: string;
  readonly region: string;
  /** null means the policy sets no numeric cap for this rule. */
  readonly limit: Money | null;
  readonly basis: LimitBasis | null;
  /** Every distinct condition the source rows attached to this rule. */
  readonly notes: readonly string[];
  /** 1-based line numbers in the source file, header included in the count. */
  readonly sourceLines: readonly number[];
}

export interface Diagnostic {
  readonly level: 'info' | 'warning';
  readonly code:
    | 'duplicate_row'
    | 'conflicting_limit'
    | 'conflicting_currency'
    | 'malformed_row'
    | 'unreadable_limit';
  readonly message: string;
  readonly lines: readonly number[];
}

export interface Policy {
  readonly rules: readonly PolicyRule[];
  /**
   * What loading had to decide. Surfaced rather than swallowed: `--diagnostics`
   * prints them, and the tests assert on them. Silently dropping a row is how a
   * policy engine quietly starts giving wrong answers.
   */
  readonly diagnostics: readonly Diagnostic[];
  readonly categories: readonly string[];
  readonly regions: readonly string[];
  /** Where the rules came from, for citations. */
  readonly source: string;
}
