import { formatMoney } from '../money.js';
import type { PolicyRule } from '../policy/types.js';
import type { QuestionAnalysis } from '../retrieval/question.js';

/**
 * Turns rules into English. Shared by the offline composer and by the prompt
 * the hosted model is given, so both are working from exactly the same words.
 */

/** "USD 220.00 per night" — or "no fixed limit" where the policy sets none. */
export function describeLimit(rule: PolicyRule): string {
  if (!rule.limit) return 'no fixed limit';
  return rule.basis ? `${formatMoney(rule.limit)} ${rule.basis}` : formatMoney(rule.limit);
}

/** "Hotel in the United Kingdom: USD 220.00 per night" */
export function describeRule(rule: PolicyRule): string {
  return `${rule.category} ${describeRegion(rule.region)}: ${describeLimit(rule)}`;
}

/** "in the United Kingdom", or "worldwide" for the policy's Global region. */
export function describeRegion(region: string): string {
  return isGlobal(region) ? 'worldwide' : `in ${withArticle(region)}`;
}

export function isGlobal(region: string): boolean {
  return region.toLowerCase() === 'global';
}

/**
 * Some regions read badly without an article. "Meals in United Kingdom" is
 * wrong; "Meals in India" is right. Rather than tag the data, the handful of
 * plural-form country names are listed here.
 */
export function withArticle(region: string): string {
  const needsThe = /\b(kingdom|states|emirates|republic|netherlands|philippines)\b/i.test(region);
  return needsThe ? `the ${region}` : region;
}

export interface ApplicableNotes {
  readonly notes: readonly string[];
  /** True when a condition in the question ruled some of the notes out. */
  readonly narrowed: boolean;
}

/**
 * Picks the notes that actually apply.
 *
 * The Airfare rule carries two conditions — economy under six hours, business
 * over six hours — so a question that mentions an eight-hour flight should get
 * one of them, not both. Notes with no duration condition always apply.
 */
export function applicableNotes(rule: PolicyRule, analysis: QuestionAnalysis): ApplicableNotes {
  const hours = analysis.durationHours;
  if (hours === null) return { notes: rule.notes, narrowed: false };

  const notes = rule.notes.filter((note) => {
    const under = /\bunder\s+(\d+(?:\.\d+)?)\s*hours?\b/i.exec(note);
    if (under) return hours < Number(under[1]);

    const over = /\bover\s+(\d+(?:\.\d+)?)\s*hours?\b/i.exec(note);
    if (over) return hours > Number(over[1]);

    return true;
  });

  // A duration that satisfies nothing (exactly six hours, on this policy) is a
  // genuine gap in the wording. Fall back to every note and let the reader see
  // both, rather than silently answering with none.
  if (notes.length === 0) return { notes: rule.notes, narrowed: false };

  return { notes, narrowed: notes.length < rule.notes.length };
}

/**
 * The notes worth printing: those that still apply after any condition in the
 * question, minus the ones that only restate the basis. A rule shown as
 * "USD 90.00 per day" does not need "Per day" repeated after it.
 */
export function informativeNotes(rule: PolicyRule, analysis: QuestionAnalysis): readonly string[] {
  const basisTokens = new Set((rule.basis ?? '').split(' ').filter(Boolean));

  return applicableNotes(rule, analysis).notes.filter((note) => {
    const tokens = note
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    return tokens.length > 0 && !tokens.every((token) => basisTokens.has(token));
  });
}

/**
 * Regions as a sentence. "Global" is not a place, so it is reported as what it
 * means rather than listed alongside countries.
 */
export function regionList(regions: readonly string[]): string {
  const named = list(regions.filter((region) => !isGlobal(region)).map(withArticle));
  const worldwide = regions.some(isGlobal);

  if (!worldwide) return named;
  return named === '' ? 'every region' : `${named}, plus rules that apply worldwide`;
}

/** "a, b and c" */
export function list(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]!}`;
}

/** "Per day; includes tips" reads better in a sentence as "per day; includes tips". */
export function sentence(text: string): string {
  const trimmed = text.trim().replace(/\.$/, '');
  return trimmed === '' ? '' : `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}.`;
}
