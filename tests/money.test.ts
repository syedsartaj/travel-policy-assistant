import { describe, expect, it } from 'vitest';

import { formatMoney, money, multiplyMoney, parseDecimalToMinor, subtractMoney } from '../src/money.js';

describe('parseDecimalToMinor', () => {
  it.each([
    ['75', 7500],
    ['90.5', 9050],
    ['90.50', 9050],
    ['0', 0],
    ['1,200', 120000],
    ['  40  ', 4000],
  ])('reads %j as %i minor units', (input, expected) => {
    expect(parseDecimalToMinor(input)).toBe(expected);
  });

  it.each([[''], ['   '], ['abc'], ['40 USD'], ['1.005'], ['4e2']])(
    'returns null for %j rather than a wrong number',
    (input) => {
      expect(parseDecimalToMinor(input)).toBeNull();
    },
  );
});

describe('money', () => {
  it('refuses fractional minor units, which are always a bug', () => {
    expect(() => money(90.5, 'USD')).toThrow(TypeError);
  });

  it('formats with the currency first and two decimals', () => {
    expect(formatMoney(money(9000, 'USD'))).toBe('USD 90.00');
    expect(formatMoney(money(9050, 'usd'))).toBe('USD 90.50');
    expect(formatMoney(money(120000, 'USD'))).toBe('USD 1,200.00');
  });

  it('multiplies exactly, where 220.00 * 3 in floats would not', () => {
    expect(multiplyMoney(money(22000, 'USD'), 3)).toEqual({ minor: 66000, currency: 'USD' });
  });

  it('will not subtract one currency from another', () => {
    expect(() => subtractMoney(money(100, 'USD'), money(100, 'GBP'))).toThrow(TypeError);
  });
});
