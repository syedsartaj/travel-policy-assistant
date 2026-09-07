import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { buildVerdict } from '../src/answer/verdict.js';
import { BUNDLED_POLICY_FILE } from '../src/config.js';
import { loadPolicy } from '../src/policy/load.js';
import { analyseQuestion } from '../src/retrieval/question.js';
import { retrieve } from '../src/retrieval/retrieve.js';

const policy = loadPolicy(readFileSync(BUNDLED_POLICY_FILE, 'utf8'), 'travel_expense_policy.csv');

function look(question: string) {
  const analysis = analyseQuestion(question, policy);
  const retrieval = retrieve(policy, analysis);
  return { analysis, retrieval, verdict: buildVerdict(retrieval, analysis) };
}

describe('retrieve', () => {
  it('finds the rule for a category and region', () => {
    const { retrieval } = look('what is the meal limit in Dubai?');

    expect(retrieval.coverage).toBe('covered');
    expect(retrieval.matches).toHaveLength(1);
    expect(retrieval.matches[0]?.rule.id).toBe('meals:united-arab-emirates');
    expect(retrieval.matches[0]?.viaGlobal).toBe(false);
  });

  it('falls back to a worldwide rule when the region has none of its own', () => {
    const { retrieval } = look('can I fly business class to London?');

    expect(retrieval.matches[0]?.rule.region).toBe('Global');
    expect(retrieval.matches[0]?.viaGlobal).toBe(true);
  });

  it('prefers a region-specific rule over the worldwide one', () => {
    const { retrieval } = look('what is the hotel limit in London?');

    expect(retrieval.matches[0]?.rule.region).toBe('United Kingdom');
    expect(retrieval.matches[0]?.viaGlobal).toBe(false);
  });

  describe('saying no', () => {
    it('does not answer a Taxi question about India from the UK rule', () => {
      const { retrieval } = look('can I claim a taxi in India?');

      expect(retrieval.coverage).toBe('not_covered');
      expect(retrieval.matches).toEqual([]);
      expect(retrieval.unmatchedCategories).toEqual(['Taxi']);
    });

    it('does not answer about a region the policy has never heard of', () => {
      const { retrieval } = look('what is the meal limit in Germany?');

      expect(retrieval.coverage).toBe('not_covered');
      expect(retrieval.unknownRegion).toBe('Germany');
      expect(retrieval.matches).toEqual([]);
    });

    it('does not dress up a rail question as a list of hotel limits', () => {
      const { retrieval } = look('can I claim the train to Manchester?');

      expect(retrieval.coverage).toBe('not_covered');
      expect(retrieval.matches).toEqual([]);
    });

    it('marks a question that was never about the policy as out of scope', () => {
      expect(look('what is the capital of France?').retrieval.coverage).toBe('out_of_scope');
    });
  });

  it('summarises a region when the question is that broad', () => {
    const { retrieval } = look('how much can I spend in Dubai?');

    expect(retrieval.isSummary).toBe(true);
    expect(retrieval.matches.map((match) => match.rule.id)).toEqual([
      'meals:united-arab-emirates',
      'hotel:united-arab-emirates',
      'airfare:global',
      'incidentals:global',
    ]);
  });
});

describe('buildVerdict', () => {
  it('allows a claim under the limit', () => {
    const { verdict } = look('can I expense an $85 dinner in Dubai?');

    expect(verdict?.status).toBe('within_limit');
  });

  it('allows a claim exactly on the limit', () => {
    expect(look('can I expense a $90 dinner in Dubai?').verdict?.status).toBe('at_limit');
  });

  it('refuses a claim over the limit and says by how much', () => {
    const { verdict } = look('can I expense a $95 dinner in Dubai?');

    expect(verdict?.status).toBe('over_limit');
    expect(verdict?.excess).toEqual({ minor: 500, currency: 'USD' });
  });

  it('compares a multi-night stay against the multiplied allowance', () => {
    const { verdict } = look('is a 3 night hotel stay in London at $700 within policy?');

    expect(verdict?.limit).toEqual({ minor: 66000, currency: 'USD' });
    expect(verdict?.status).toBe('over_limit');
    expect(verdict?.excess).toEqual({ minor: 4000, currency: 'USD' });
  });

  it('does not compare pennies through floating point', () => {
    // 0.1 + 0.2 arithmetic would put this a fraction over and reject it.
    const { verdict } = look('can I expense a $75.00 dinner in London?');

    expect(verdict?.status).toBe('at_limit');
  });

  it('says a rule has no cap rather than treating it as zero', () => {
    expect(look('can I claim a £40 taxi in London?').verdict?.status).toBe('currency_not_supported');
    expect(look('what about a taxi in London?').verdict?.status).toBe('no_cap');
  });

  it('refuses to convert a currency instead of guessing a rate', () => {
    const { verdict } = look('can I claim £60 for lunch in London?');

    expect(verdict?.status).toBe('currency_not_supported');
    expect(verdict?.foreignCurrency).toBe('GBP');
  });

  it('declines to judge when it cannot tell which rule the money belongs to', () => {
    // "$95" could be the meal or the hotel. Guessing would be worse than silence.
    expect(look('hotel and meals in Dubai, is $95 alright?').verdict).toBeNull();
  });

  it('does judge when only one of the matched rules carries a number', () => {
    const { verdict } = look('taxi and meals in London, is $60 alright?');

    expect(verdict?.rule.category).toBe('Meals');
    expect(verdict?.status).toBe('within_limit');
  });
});
