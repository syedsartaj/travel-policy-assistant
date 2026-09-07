import { describe, expect, it } from 'vitest';

import { PolicyAssistant } from '../src/assistant.js';

/**
 * End to end, through the default offline model, against the policy file that
 * ships with the repository. These are the answers a reviewer will see.
 */
const assistant = await PolicyAssistant.create({}, {});

async function answer(question: string) {
  return assistant.ask(question);
}

describe('the assistant', () => {
  it('quotes a limit and shows where it came from', async () => {
    const result = await answer('What is the meal limit in the UK?');

    expect(result.coverage).toBe('covered');
    expect(result.text).toContain('USD 75.00 per day');
    expect(result.citations).toEqual([
      { rule: 'meals:united-kingdom', category: 'Meals', region: 'United Kingdom', lines: [2, 14] },
    ]);
  });

  it('rules on a claim and shows the arithmetic', async () => {
    const result = await answer('Can I expense a $95 dinner in Dubai?');

    expect(result.verdict?.status).toBe('over_limit');
    expect(result.text).toContain('Over the limit');
    expect(result.text).toContain('USD 5.00 over');
  });

  it('multiplies a nightly cap across a stay', async () => {
    const result = await answer('Is a 3 night hotel stay in London at $700 within policy?');

    expect(result.text).toContain('3 nights allows USD 660.00');
  });

  describe('saying the policy does not cover it', () => {
    it('says so for a category the region has no rule for', async () => {
      const result = await answer('Can I claim a taxi in India?');

      expect(result.coverage).toBe('not_covered');
      expect(result.text).toContain('does not cover');
      expect(result.text).toContain('United Kingdom');
      expect(result.citations).toEqual([]);
    });

    it('says so for a region the policy has never heard of', async () => {
      const result = await answer('What is the meal limit in Germany?');

      expect(result.coverage).toBe('not_covered');
      expect(result.text).toContain('Germany');
    });

    it('says so for an expense the policy is silent on', async () => {
      const result = await answer('Can I claim the train to Manchester?');

      expect(result.coverage).toBe('not_covered');
      expect(result.text).toContain('does not cover');
    });

    it('says so for a question that was never about expenses', async () => {
      const result = await answer('What is the capital of France?');

      expect(result.coverage).toBe('out_of_scope');
      expect(result.text).not.toMatch(/Paris/i);
    });

    /**
     * The point of the whole design: an answer the policy does not support
     * contains no figures at all, because the composer is only ever given the
     * rules that were retrieved, and there were none.
     */
    it('never quotes a number in an answer the policy does not support', async () => {
      for (const question of [
        'Can I claim a taxi in India?',
        'What is the meal limit in Germany?',
        'What is the capital of France?',
        'Can I expense a $500 helicopter transfer?',
      ]) {
        const result = await answer(question);

        expect(result.coverage).not.toBe('covered');
        expect(result.text).not.toMatch(/USD \d/);
      }
    });
  });

  it('picks the flight rule that matches the flight', async () => {
    const long = await answer('Can I fly business class on an 8 hour flight?');
    const short = await answer('Can I fly business class on a 3 hour flight?');

    expect(long.text).toContain('Business class permitted for flights over 6 hours');
    expect(long.text).not.toContain('Economy only');
    expect(short.text).toContain('Economy only for flights under 6 hours');
  });

  it('summarises a region when asked broadly', async () => {
    const result = await answer('How much can I spend in Dubai?');

    expect(result.text).toContain('USD 90.00 per day');
    expect(result.text).toContain('USD 300.00 per night');
    expect(result.text).toContain('a worldwide rule');
  });

  it('says it will not convert currencies rather than guessing a rate', async () => {
    const result = await answer('Can I claim £60 for lunch in London?');

    expect(result.text).toContain('does not convert currencies');
    expect(result.verdict?.foreignCurrency).toBe('GBP');
  });

  it('gives the same answer every time', async () => {
    const first = await answer('Can I expense a $95 dinner in Dubai?');
    const second = await answer('Can I expense a $95 dinner in Dubai?');

    expect(first.text).toBe(second.text);
  });

  it('reports which model wrote the answer', async () => {
    expect((await answer('meals in India')).provider).toBe('offline');
  });
});
