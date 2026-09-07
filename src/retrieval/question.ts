import { money, parseDecimalToMinor, type Money } from '../money.js';
import type { Policy } from '../policy/types.js';
import { CATEGORY_ALIASES, EXPENSE_TERMS, FOREIGN_CURRENCIES, REGION_ALIASES, type AliasTable } from './vocabulary.js';

export interface Quantity {
  readonly count: number;
  readonly unit: 'day' | 'night';
}

export interface QuestionAnalysis {
  readonly question: string;
  /** Policy categories the question refers to, spelled as the policy spells them. */
  readonly categories: readonly string[];
  readonly regions: readonly string[];
  /** The sum the user is asking about, if they named one. */
  readonly amount: Money | null;
  /**
   * Set when the user named a currency the policy is not written in. The policy
   * is stated in USD and this tool does not do foreign exchange, so the honest
   * answer is to say so rather than to invent a rate.
   */
  readonly foreignCurrency: string | null;
  /**
   * A place the question names that the policy has no region for — "Germany"
   * in "what is the meal limit in Germany?". Only set when no policy region
   * matched, and it is what lets the answer name what is missing instead of
   * listing four regions the reader did not ask about.
   */
  readonly unknownRegion: string | null;
  readonly quantity: Quantity | null;
  /** Flight length, which is what the Airfare rules turn on. */
  readonly durationHours: number | null;
  /** Whether the question is recognisably about expenses at all. */
  readonly isExpenseQuestion: boolean;
  /**
   * True when the question asks what the policy says in general — "how much can
   * I spend in Dubai?" — rather than about one thing in particular. It is what
   * separates a request for a summary from "can I claim the train?", which
   * names something the policy does not cover and deserves to be told so.
   */
  readonly isBroadQuestion: boolean;
}

/**
 * Reads a plain-English question into the few facts the policy can be searched
 * with. Nothing here is a language model — it is deliberate, testable string
 * work, so the same question always produces the same retrieval.
 */
export function analyseQuestion(question: string, policy: Policy): QuestionAnalysis {
  const haystack = padded(question.toLowerCase());
  const casedHaystack = padded(question);

  const categories = matchValues(policy.categories, CATEGORY_ALIASES, haystack, casedHaystack);
  const regions = matchValues(policy.regions, REGION_ALIASES, haystack, casedHaystack);
  const { amount, foreignCurrency } = readAmount(question);

  return {
    question,
    categories,
    regions,
    amount,
    foreignCurrency,
    unknownRegion: readUnknownRegion(question, regions, policy),
    quantity: readQuantity(question),
    durationHours: readDurationHours(question),
    isExpenseQuestion:
      categories.length > 0 ||
      regions.length > 0 ||
      amount !== null ||
      foreignCurrency !== null ||
      EXPENSE_TERMS.some((term) => haystack.includes(padded(term))),
    isBroadQuestion: BROAD_QUESTION.test(question),
  };
}

/**
 * Matches the policy's own values first, then their aliases. Returning every
 * match rather than the best one is intentional: "hotel and meals in Dubai" is
 * two questions in one sentence and deserves both answers.
 */
function matchValues(
  values: readonly string[],
  tables: readonly AliasTable[],
  haystack: string,
  casedHaystack: string,
): string[] {
  const matched: string[] = [];

  for (const value of values) {
    const canonical = value.toLowerCase();
    const table = tables.find((entry) => entry.canonical === canonical);
    const aliases = [canonical, ...(table?.aliases ?? [])];

    const hit =
      aliases.some((alias) => haystack.includes(padded(alias))) ||
      (table?.casedAliases ?? []).some((alias) => casedHaystack.includes(padded(alias)));

    if (hit) matched.push(value);
  }

  return matched;
}

/**
 * Word-boundary matching without regex escaping: both sides are reduced to
 * space-separated tokens and padded, so " uk " cannot match inside "ukraine".
 * Full stops are removed rather than treated as separators, which folds "U.S."
 * onto "US" and keeps a sentence-final "...in Dubai." matchable.
 */
function padded(text: string): string {
  return ` ${text
    .replace(/\./g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;
}

const BROAD_QUESTION =
  /\b(?:how much|what(?:'s| is| are)?\s+(?:the\s+)?(?:limit|limits|allowance|allowances|rule|rules|policy)|what can i (?:spend|claim|expense)|what does the policy|per diem|summar(?:y|ise|ize)|list the)\b/i;

const SPEND_VERB = /\b(spend|spent|spending|claim|claiming|expense|expensing|charge|charging|pay|paying|cost|costs|costing|reimburse)\b/i;
const UNIT_AFTER_NUMBER = /^\s*(nights?|days?|hours?|hrs?|people|persons?|guests?|km|miles?|%)/i;

function readAmount(question: string): { amount: Money | null; foreignCurrency: string | null } {
  const foreign = readForeignCurrency(question);
  if (foreign) return { amount: null, foreignCurrency: foreign };

  const usd =
    /\bus?\$\s?(\d[\d,]*(?:\.\d{1,2})?)/i.exec(question) ??
    /\$\s?(\d[\d,]*(?:\.\d{1,2})?)/.exec(question) ??
    /\busd\s?(\d[\d,]*(?:\.\d{1,2})?)/i.exec(question) ??
    /(\d[\d,]*(?:\.\d{1,2})?)\s*(?:usd|us dollars|dollars|dollar|bucks)\b/i.exec(question);

  if (usd) {
    const minor = parseDecimalToMinor(usd[1]!);
    if (minor !== null) return { amount: money(minor, 'USD'), foreignCurrency: null };
  }

  // A bare number only counts as a sum of money when the sentence is about
  // spending it, and when it is not the "3" in "3 nights".
  if (SPEND_VERB.test(question)) {
    for (const match of question.matchAll(/\b(\d[\d,]*(?:\.\d{1,2})?)\b/g)) {
      const after = question.slice((match.index ?? 0) + match[0].length);
      if (UNIT_AFTER_NUMBER.test(after)) continue;
      const minor = parseDecimalToMinor(match[1]!);
      if (minor !== null) return { amount: money(minor, 'USD'), foreignCurrency: null };
    }
  }

  return { amount: null, foreignCurrency: null };
}

/**
 * The policy is written entirely in USD and this tool does no foreign exchange,
 * so naming another currency has to be recognised and refused. Guessing a rate
 * would produce an answer that looks authoritative and is not.
 */
function readForeignCurrency(question: string): string | null {
  const symbol = /[\u00A3\u20AC\u20B9]\s?\d/.exec(question);
  if (symbol) {
    const codes: Record<string, string> = { '\u00A3': 'GBP', '\u20AC': 'EUR', '\u20B9': 'INR' };
    return codes[symbol[0]![0]!] ?? null;
  }

  // Look at the word on either side of each number: "220 GBP", "AED 1200",
  // "300 dirhams". Scanning every number in the sentence rather than the first
  // number-word pair means "a 220 GBP hotel" is not read as the pair "a 220".
  for (const match of question.matchAll(/\d[\d,]*(?:\.\d{1,2})?/g)) {
    const at = match.index ?? 0;
    const after = /^\W*([A-Za-z]+)/.exec(question.slice(at + match[0].length))?.[1];
    const before = /([A-Za-z]+)\W*$/.exec(question.slice(0, at))?.[1];

    for (const word of [after, before]) {
      const code = word ? FOREIGN_CURRENCIES.get(word.toLowerCase()) : undefined;
      if (code) return code;
    }
  }

  return null;
}

/**
 * Looks for "in <Somewhere>" where <Somewhere> is capitalised and is not a
 * region, category or alias we know. Only prepositions that introduce a place
 * are used, so "claim for Meals" is not read as a country.
 *
 * Capitalisation is the signal, which means "meals in germany" falls through to
 * the broader answer that lists every region. That is the safe direction to
 * fail: the reader sees the whole policy rather than a wrong refusal.
 */
function readUnknownRegion(question: string, matchedRegions: readonly string[], policy: Policy): string | null {
  if (matchedRegions.length > 0) return null;

  const match = /\b(?:in|to)\s+(?:the\s+)?([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)*)/u.exec(question);
  const place = match?.[1]?.trim();
  if (!place || place.length < 3) return null;

  const known = new Set<string>([
    ...policy.categories.map((value) => value.toLowerCase()),
    ...policy.regions.map((value) => value.toLowerCase()),
    ...CATEGORY_ALIASES.flatMap((table) => [table.canonical, ...table.aliases]),
    ...REGION_ALIASES.flatMap((table) => [table.canonical, ...table.aliases]),
  ]);

  return known.has(place.toLowerCase()) ? null : place;
}

function readQuantity(question: string): Quantity | null {
  const match = /\b(\d+)\s*(nights?|days?)\b/i.exec(question);
  if (!match) return null;

  const count = Number(match[1]);
  if (!Number.isSafeInteger(count) || count < 1) return null;

  return { count, unit: match[2]!.toLowerCase().startsWith('night') ? 'night' : 'day' };
}

function readDurationHours(question: string): number | null {
  const match = /\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i.exec(question);
  if (!match) return null;

  const hours = Number(match[1]);
  return Number.isFinite(hours) ? hours : null;
}
