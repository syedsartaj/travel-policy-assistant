import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { BUNDLED_POLICY_FILE } from '../src/config.js';
import { loadPolicy, PolicyFormatError } from '../src/policy/load.js';
import type { Policy } from '../src/policy/types.js';

const HEADER = 'category,region,daily_limit_usd,currency,notes';

function load(...rows: string[]): Policy {
  return loadPolicy([HEADER, ...rows].join('\n'), 'test.csv');
}

const bundled = loadPolicy(readFileSync(BUNDLED_POLICY_FILE, 'utf8'), 'travel_expense_policy.csv');

function rule(policy: Policy, category: string, region: string) {
  return policy.rules.find((candidate) => candidate.category === category && candidate.region === region);
}

describe('loadPolicy', () => {
  it('reads a limit into minor units and keeps the policy wording', () => {
    const meals = rule(bundled, 'Meals', 'United Arab Emirates');

    expect(meals?.limit).toEqual({ minor: 9000, currency: 'USD' });
    expect(meals?.basis).toBe('per day');
    expect(meals?.notes).toEqual(['Per day']);
  });

  it('treats a blank limit as "no cap", not as zero', () => {
    expect(rule(bundled, 'Taxi', 'United Kingdom')?.limit).toBeNull();
  });

  it('reads a nightly cap as nightly', () => {
    expect(rule(bundled, 'Hotel', 'United Kingdom')?.basis).toBe('per night');
  });

  describe('duplicate handling', () => {
    it('merges the repeated Meals/United Kingdom row into one rule', () => {
      const meals = bundled.rules.filter((r) => r.category === 'Meals' && r.region === 'United Kingdom');

      expect(meals).toHaveLength(1);
      expect(meals[0]?.notes).toEqual(['Per day; includes tips']);
      // Both rows state the same limit, so both are cited as its source.
      expect(meals[0]?.sourceLines).toEqual([2, 14]);
    });

    it('reports the merge rather than doing it silently', () => {
      const merged = bundled.diagnostics.filter((d) => d.code === 'duplicate_row');

      expect(merged).toHaveLength(1);
      expect(merged[0]?.message).toContain('Line 14');
      expect(merged[0]?.level).toBe('info');
    });

    it('keeps both Airfare rows, because their conditions differ', () => {
      const airfare = bundled.rules.filter((r) => r.category === 'Airfare');

      // One entitlement, two conditions. De-duplicating on category+region
      // alone would delete the long-haul rule.
      expect(airfare).toHaveLength(1);
      expect(airfare[0]?.notes).toEqual([
        'Economy only for flights under 6 hours',
        'Business class permitted for flights over 6 hours',
      ]);
    });

    it('drops a note that only repeats another, whatever the row order', () => {
      const policy = load(
        'Meals,India,40,USD,Per day (duplicate)',
        'Meals,India,40,USD,Per day; includes tips',
      );

      expect(policy.rules).toHaveLength(1);
      expect(policy.rules[0]?.notes).toEqual(['Per day; includes tips']);
    });

    it('keeps one copy of two identical rows', () => {
      const policy = load('Meals,India,40,USD,Per day', 'Meals,India,40,USD,Per day');

      expect(policy.rules[0]?.notes).toEqual(['Per day']);
    });
  });

  describe('bad data', () => {
    it('takes the lower limit when a category and region are given two, and says so', () => {
      const policy = load('Meals,India,40,USD,Per day', 'Meals,India,60,USD,Per day');

      expect(policy.rules[0]?.limit).toEqual({ minor: 4000, currency: 'USD' });
      expect(policy.diagnostics.map((d) => d.code)).toContain('conflicting_limit');
    });

    it('skips a row whose limit is not a number rather than reading it as "no cap"', () => {
      const policy = load('Meals,India,about forty,USD,Per day');

      expect(policy.rules).toHaveLength(0);
      expect(policy.diagnostics[0]?.code).toBe('unreadable_limit');
    });

    it('skips a row with no category or region', () => {
      const policy = load(',India,40,USD,Per day');

      expect(policy.rules).toHaveLength(0);
      expect(policy.diagnostics[0]?.code).toBe('malformed_row');
    });

    it('rejects a file that is missing a required column, naming what is missing', () => {
      expect(() => loadPolicy('category,region\nMeals,India\n', 'test.csv')).toThrow(PolicyFormatError);
      expect(() => loadPolicy('category,region\nMeals,India\n', 'test.csv')).toThrow(/daily_limit_usd/);
    });

    it('does not care what order the columns are in', () => {
      const policy = loadPolicy(
        'notes,currency,daily_limit_usd,region,category\nPer day,USD,40,India,Meals\n',
        'test.csv',
      );

      expect(policy.rules[0]?.limit).toEqual({ minor: 4000, currency: 'USD' });
    });
  });

  it('takes its categories and regions from the file, not from the code', () => {
    const policy = load('Rail,Japan,55,USD,Per day');

    expect(policy.categories).toEqual(['Rail']);
    expect(policy.regions).toEqual(['Japan']);
  });

  it('loads the shipped policy into thirteen rows and eleven rules', () => {
    expect(bundled.rules).toHaveLength(11);
    expect(bundled.categories).toEqual(['Meals', 'Hotel', 'Taxi', 'Airfare', 'Incidentals']);
  });
});
