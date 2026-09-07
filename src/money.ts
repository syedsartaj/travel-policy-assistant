/**
 * Money is held as an integer number of minor units (cents) plus an ISO currency
 * code. Policy limits get compared against claims, and binary floating point is
 * the wrong tool for that: 0.1 + 0.2 !== 0.3, and a claim that is exactly on the
 * limit must never round to "over".
 */

export interface Money {
  /** Integer minor units — cents for USD. Never a fraction. */
  readonly minor: number;
  /** ISO 4217 code, upper case. */
  readonly currency: string;
}

export function money(minor: number, currency: string): Money {
  if (!Number.isInteger(minor)) {
    throw new TypeError(`money() needs whole minor units, received ${minor}`);
  }
  return { minor, currency: currency.toUpperCase() };
}

/**
 * Parses a decimal string such as "75", "90.50" or "1,200" into minor units
 * without going through a float. Returns null for anything that is not a plain
 * decimal number, which is how a blank CSV cell reaches us.
 */
export function parseDecimalToMinor(input: string): number | null {
  const trimmed = input.trim().replace(/,/g, '');
  if (trimmed === '') return null;
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) return null;

  const [, sign = '', whole = '0', fraction = ''] = match;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0') || '0');
  return sign === '-' ? -cents : cents;
}

/** "USD 90.00". Currency first, because the amount alone is meaningless here. */
export function formatMoney(value: Money): string {
  const sign = value.minor < 0 ? '-' : '';
  const abs = Math.abs(value.minor);
  const whole = Math.floor(abs / 100);
  const cents = abs % 100;
  return `${value.currency} ${sign}${whole.toLocaleString('en-US')}.${String(cents).padStart(2, '0')}`;
}

export function multiplyMoney(value: Money, factor: number): Money {
  if (!Number.isInteger(factor)) {
    throw new TypeError(`multiplyMoney() needs a whole factor, received ${factor}`);
  }
  return money(value.minor * factor, value.currency);
}

export function subtractMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new TypeError(`cannot subtract ${b.currency} from ${a.currency}`);
  }
  return money(a.minor - b.minor, a.currency);
}
