/**
 * The only place in the codebase that knows English.
 *
 * Everything else works off whatever the policy file happens to contain. This
 * table is additive sugar on top of that: it lets "dinner in Dubai" reach the
 * Meals / United Arab Emirates rule. A category or region that appears in a
 * policy file and not here still matches on its own name, so a new CSV never
 * needs a code change to work — only to understand slang.
 *
 * Deliberately conservative. An alias that guesses wrong produces a confident
 * answer about the wrong rule, which is worse than saying "not covered": the
 * reader has no way to tell the two apart. So "tips" is not mapped to
 * Incidentals (the Meals rule already mentions tips), and "laundry" is not
 * mapped at all, because the policy genuinely does not cover it.
 */

export interface AliasTable {
  /** Lower-case canonical name, as it appears in the policy file. */
  readonly canonical: string;
  /** Matched case-insensitively, as whole words. */
  readonly aliases: readonly string[];
  /**
   * Matched case-SENSITIVELY. Reserved for abbreviations that collide with
   * ordinary words: "US" is a country, "us" is a pronoun, and "can us claim
   * breakfast" must not be read as a question about America.
   */
  readonly casedAliases?: readonly string[];
}

export const CATEGORY_ALIASES: readonly AliasTable[] = [
  {
    canonical: 'meals',
    aliases: [
      'meal', 'meals', 'food', 'dinner', 'lunch', 'breakfast', 'brunch',
      'dining', 'restaurant', 'eat', 'eating', 'subsistence', 'per diem',
    ],
  },
  {
    canonical: 'hotel',
    aliases: [
      'hotel', 'hotels', 'accommodation', 'accomodation', 'lodging',
      'room', 'rooms', 'stay', 'overnight', 'night', 'nights',
    ],
  },
  {
    canonical: 'taxi',
    aliases: ['taxi', 'taxis', 'cab', 'cabs', 'uber', 'careem', 'rideshare', 'ride hailing'],
  },
  {
    canonical: 'airfare',
    aliases: [
      'airfare', 'air fare', 'flight', 'flights', 'fly', 'flying', 'plane',
      'airline', 'airlines', 'economy', 'business class', 'premium economy',
    ],
  },
  {
    canonical: 'incidentals',
    aliases: ['incidental', 'incidentals', 'sundries', 'sundry', 'miscellaneous'],
  },
];

export const REGION_ALIASES: readonly AliasTable[] = [
  {
    canonical: 'united kingdom',
    aliases: [
      'united kingdom', 'uk', 'britain', 'great britain', 'england', 'scotland',
      'wales', 'northern ireland', 'london', 'manchester', 'birmingham',
      'edinburgh', 'glasgow', 'bristol', 'leeds',
    ],
  },
  {
    canonical: 'united states',
    aliases: [
      'united states', 'united states of america', 'usa', 'america', 'the states',
      'new york', 'nyc', 'san francisco', 'los angeles', 'chicago', 'boston',
      'seattle', 'washington dc',
    ],
    casedAliases: ['US', 'U.S.', 'U.S.A.'],
  },
  {
    canonical: 'united arab emirates',
    aliases: [
      'united arab emirates', 'uae', 'emirates', 'dubai', 'abu dhabi',
      'sharjah', 'ajman', 'ras al khaimah', 'fujairah',
    ],
  },
  {
    canonical: 'india',
    aliases: [
      'india', 'mumbai', 'bombay', 'delhi', 'new delhi', 'bengaluru',
      'bangalore', 'hyderabad', 'chennai', 'pune', 'kolkata', 'goa',
    ],
  },
  {
    canonical: 'global',
    aliases: ['global', 'globally', 'worldwide', 'anywhere', 'everywhere', 'any country'],
  },
];

/**
 * Words that make a question an expense question even when nothing else
 * matches. They are what separates "can I claim for the train?" — a fair
 * question this policy has no answer to — from "what is the capital of France",
 * which was never a policy question at all.
 */
export const EXPENSE_TERMS: readonly string[] = [
  'expense', 'expenses', 'expensed', 'claim', 'claims', 'claimed', 'reimburse',
  'reimbursed', 'reimbursement', 'allowance', 'limit', 'limits', 'cap', 'budget',
  'policy', 'per diem', 'receipt', 'receipts', 'spend', 'spent', 'travel',
  'trip', 'business trip', 'invoice', 'refund',
];

/** Currency words we understand well enough to know we cannot convert them. */
export const FOREIGN_CURRENCIES: ReadonlyMap<string, string> = new Map([
  ['gbp', 'GBP'], ['pound', 'GBP'], ['pounds', 'GBP'], ['sterling', 'GBP'],
  ['eur', 'EUR'], ['euro', 'EUR'], ['euros', 'EUR'],
  ['aed', 'AED'], ['dirham', 'AED'], ['dirhams', 'AED'],
  ['inr', 'INR'], ['rupee', 'INR'], ['rupees', 'INR'],
]);
