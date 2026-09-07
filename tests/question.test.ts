import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { BUNDLED_POLICY_FILE } from '../src/config.js';
import { loadPolicy } from '../src/policy/load.js';
import { analyseQuestion } from '../src/retrieval/question.js';

const policy = loadPolicy(readFileSync(BUNDLED_POLICY_FILE, 'utf8'), 'travel_expense_policy.csv');
const ask = (question: string) => analyseQuestion(question, policy);

describe('analyseQuestion', () => {
  describe('categories', () => {
    it.each([
      ['Can I expense dinner?', 'Meals'],
      ['what is the accommodation limit', 'Hotel'],
      ['can I get a cab from the airport', 'Taxi'],
      ['is business class allowed', 'Airfare'],
      ['what about incidentals', 'Incidentals'],
    ])('reads %j as %s', (question, category) => {
      expect(ask(question).categories).toEqual([category]);
    });

    it('finds every category a question names', () => {
      expect(ask('hotel and meals in Dubai').categories).toEqual(['Meals', 'Hotel']);
    });

    it('matches whole words only', () => {
      // "stay" is a Hotel alias; "mainstay" must not be.
      expect(ask('is that the mainstay of the policy').categories).toEqual([]);
    });
  });

  describe('regions', () => {
    it.each([
      ['a dinner in Dubai', 'United Arab Emirates'],
      ['three nights in London', 'United Kingdom'],
      ['travelling to Mumbai', 'India'],
      ['a trip to New York', 'United States'],
    ])('maps the city in %j to %s', (question, region) => {
      expect(ask(question).regions).toEqual([region]);
    });

    it('reads "U.S." as a country', () => {
      expect(ask('what is the meal limit in the U.S.?').regions).toEqual(['United States']);
    });

    it('does not read the pronoun "us" as a country', () => {
      expect(ask('can us claim breakfast in Delhi').regions).toEqual(['India']);
    });

    it('names a place the policy has no rules for', () => {
      const analysis = ask('what is the meal limit in Germany?');

      expect(analysis.regions).toEqual([]);
      expect(analysis.unknownRegion).toBe('Germany');
    });

    it('does not mistake a category after a preposition for a place', () => {
      expect(ask('what is the policy in Hotel bookings')?.unknownRegion).toBeNull();
    });
  });

  describe('amounts', () => {
    it.each([
      ['a $95 dinner', 9500],
      ['USD 95 for dinner', 9500],
      ['95 dollars on dinner', 9500],
      ['a $1,250 flight', 125000],
      ['a $90.50 dinner', 9050],
    ])('reads the amount in %j', (question, minor) => {
      expect(ask(question).amount).toEqual({ minor, currency: 'USD' });
    });

    it('reads a bare number when the sentence is about spending it', () => {
      expect(ask('can I spend 95 on dinner in Dubai').amount).toEqual({ minor: 9500, currency: 'USD' });
    });

    it('does not read the "3" in "3 nights" as money', () => {
      const analysis = ask('can I claim 3 nights in London');

      expect(analysis.amount).toBeNull();
      expect(analysis.quantity).toEqual({ count: 3, unit: 'night' });
    });

    it('refuses to treat a foreign currency as dollars', () => {
      for (const question of ['can I claim £60 for lunch', 'a 220 GBP hotel', 'dinner for 300 dirhams']) {
        const analysis = ask(question);
        expect(analysis.amount).toBeNull();
        expect(analysis.foreignCurrency).not.toBeNull();
      }
    });

    it('names the currency it will not convert', () => {
      expect(ask('can I claim £60 for lunch').foreignCurrency).toBe('GBP');
      expect(ask('a 1200 AED hotel').foreignCurrency).toBe('AED');
    });
  });

  it('reads a flight length, which is what the Airfare rules turn on', () => {
    expect(ask('can I fly business on an 8 hour flight').durationHours).toBe(8);
    expect(ask('a 90 minute hop').durationHours).toBeNull();
  });

  describe('scope', () => {
    it('knows an expenses question when it sees one', () => {
      expect(ask('can I claim the train?').isExpenseQuestion).toBe(true);
    });

    it('knows when a question is nothing to do with the policy', () => {
      expect(ask('what is the capital of France?').isExpenseQuestion).toBe(false);
    });

    it('separates a request for a summary from a question about one thing', () => {
      expect(ask('how much can I spend in Dubai?').isBroadQuestion).toBe(true);
      expect(ask('can I claim the train to Manchester?').isBroadQuestion).toBe(false);
    });
  });
});
