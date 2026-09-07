import { formatMoney, money, parseDecimalToMinor } from '../money.js';
import { parseCsv } from './csv.js';
import type { Diagnostic, LimitBasis, Policy, PolicyRule } from './types.js';

const REQUIRED_COLUMNS = ['category', 'region', 'daily_limit_usd', 'currency', 'notes'] as const;

export class PolicyFormatError extends Error {
  override readonly name = 'PolicyFormatError';
}

interface RawRow {
  readonly line: number;
  readonly category: string;
  readonly region: string;
  readonly limitMinor: number | null;
  readonly currency: string;
  readonly note: string;
}

/**
 * Turns the CSV text into rules.
 *
 * The interesting part is not the parsing, it is deciding what two rows sharing
 * a category and region mean. See `collapse()`.
 */
export function loadPolicy(text: string, source: string): Policy {
  const document = parseCsv(text);
  const columns = indexColumns(document.header);
  const diagnostics: Diagnostic[] = [];
  const raw: RawRow[] = [];

  for (const row of document.rows) {
    const category = (row.cells[columns.category] ?? '').trim();
    const region = (row.cells[columns.region] ?? '').trim();

    if (category === '' || region === '') {
      diagnostics.push({
        level: 'warning',
        code: 'malformed_row',
        message: `Line ${row.line} has no ${category === '' ? 'category' : 'region'} and was skipped.`,
        lines: [row.line],
      });
      continue;
    }

    const limitCell = (row.cells[columns.daily_limit_usd] ?? '').trim();
    const limitMinor = parseDecimalToMinor(limitCell);

    // A blank cell is the policy saying "no numeric cap". Text that is present
    // but unreadable is a data problem, and must not silently become "no cap".
    if (limitCell !== '' && limitMinor === null) {
      diagnostics.push({
        level: 'warning',
        code: 'unreadable_limit',
        message: `Line ${row.line} has a limit of "${limitCell}", which is not a number. The row was skipped.`,
        lines: [row.line],
      });
      continue;
    }

    raw.push({
      line: row.line,
      category,
      region,
      limitMinor,
      currency: ((row.cells[columns.currency] ?? '').trim() || 'USD').toUpperCase(),
      note: (row.cells[columns.notes] ?? '').trim(),
    });
  }

  const rules = collapse(raw, diagnostics);

  return {
    rules,
    diagnostics,
    categories: distinct(rules.map((rule) => rule.category)),
    regions: distinct(rules.map((rule) => rule.region)),
    source,
  };
}

function indexColumns(header: readonly string[]): Record<(typeof REQUIRED_COLUMNS)[number], number> {
  const lookup = new Map(header.map((name, index) => [name.trim().toLowerCase(), index]));
  const missing = REQUIRED_COLUMNS.filter((name) => !lookup.has(name));

  if (missing.length > 0) {
    throw new PolicyFormatError(
      `Policy file is missing the column${missing.length > 1 ? 's' : ''} ${missing.join(', ')}. ` +
        `Found: ${header.join(', ') || '(no header row)'}.`,
    );
  }

  // Order-independent: the file may grow columns without breaking the reader.
  return Object.fromEntries(REQUIRED_COLUMNS.map((name) => [name, lookup.get(name)!])) as Record<
    (typeof REQUIRED_COLUMNS)[number],
    number
  >;
}

/**
 * Collapses source rows into rules.
 *
 * Rows are grouped by (category, region). Within a group:
 *
 *  - Rows carrying the SAME limit describe one allowance. Their notes are the
 *    conditions on it, so they merge into a single rule. This is what makes the
 *    two Airfare/Global rows come out right: one entitlement, two conditions
 *    ("economy under 6 hours", "business over 6 hours"). De-duplicating on the
 *    category/region key alone would silently delete the long-haul rule.
 *
 *  - Rows carrying DIFFERENT limits contradict each other. The policy cannot be
 *    both, so the lower limit wins — under-reimbursing is recoverable, telling
 *    somebody they may spend more than the policy allows is not — and the clash
 *    is reported as a warning rather than resolved in silence.
 *
 * Duplicate rows are therefore handled by note subsumption rather than by row
 * equality: the repeated Meals/United Kingdom row differs textually from the
 * original ("Per day (duplicate of row 1...)"), but once the parenthetical aside
 * is set aside it says strictly less than "Per day; includes tips", so it adds
 * no condition and is dropped.
 */
function collapse(rows: readonly RawRow[], diagnostics: Diagnostic[]): PolicyRule[] {
  const groups = new Map<string, RawRow[]>();

  for (const row of rows) {
    const key = `${row.category.toLowerCase()} ${row.region.toLowerCase()}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  const rules: PolicyRule[] = [];

  for (const group of groups.values()) {
    const first = group[0]!;
    const byLimit = new Map<string, RawRow[]>();

    for (const row of group) {
      const key = row.limitMinor === null ? 'none' : String(row.limitMinor);
      const bucket = byLimit.get(key);
      if (bucket) bucket.push(row);
      else byLimit.set(key, [row]);
    }

    if (byLimit.size > 1) {
      diagnostics.push({
        level: 'warning',
        code: 'conflicting_limit',
        message:
          `${first.category} / ${first.region} is given more than one limit ` +
          `(${[...byLimit.values()].map((bucket) => describeLimit(bucket[0]!)).join(' and ')}). ` +
          'The lowest is used.',
        lines: group.map((row) => row.line),
      });
    }

    const currencies = distinct(group.map((row) => row.currency));
    if (currencies.length > 1) {
      diagnostics.push({
        level: 'warning',
        code: 'conflicting_currency',
        message: `${first.category} / ${first.region} mixes ${currencies.join(' and ')}. ${currencies[0]} is used.`,
        lines: group.map((row) => row.line),
      });
    }

    const winner = [...byLimit.values()].sort(byLowestLimit)[0]!;
    const notes = mergeNotes(winner, diagnostics);

    rules.push({
      id: `${slug(first.category)}:${slug(first.region)}`,
      category: first.category,
      region: first.region,
      limit: winner[0]!.limitMinor === null ? null : money(winner[0]!.limitMinor, currencies[0]!),
      basis: readBasis(notes),
      notes,
      sourceLines: winner.map((row) => row.line),
    });
  }

  return rules;
}

/** A missing cap sorts last: an explicit number is always the tighter rule. */
function byLowestLimit(a: RawRow[], b: RawRow[]): number {
  const left = a[0]!.limitMinor;
  const right = b[0]!.limitMinor;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

function describeLimit(row: RawRow): string {
  return row.limitMinor === null ? 'no cap' : formatMoney(money(row.limitMinor, row.currency));
}

/**
 * Keeps the notes that add something. A note is dropped when its words are a
 * subset of another note's words on the same rule, comparing on content only:
 * lower-cased, punctuation removed, and parenthetical asides set aside, since a
 * parenthetical annotates a row rather than constraining the expense.
 */
function mergeNotes(rows: readonly RawRow[], diagnostics: Diagnostic[]): string[] {
  const candidates = rows
    .map((row) => ({ row, tokens: contentTokens(row.note) }))
    .filter((candidate) => candidate.row.note !== '');

  const kept: typeof candidates = [];

  for (const candidate of candidates) {
    const covering = candidates.find(
      (other) =>
        other !== candidate &&
        isSubset(candidate.tokens, other.tokens) &&
        // On a tie (identical notes) the earlier line is the one that survives.
        (candidate.tokens.size < other.tokens.size || other.row.line < candidate.row.line),
    );

    if (covering) {
      diagnostics.push({
        level: 'info',
        code: 'duplicate_row',
        message:
          `Line ${candidate.row.line} repeats ${candidate.row.category} / ${candidate.row.region} ` +
          `and adds no condition beyond line ${covering.row.line}. Merged.`,
        lines: [covering.row.line, candidate.row.line],
      });
      continue;
    }

    kept.push(candidate);
  }

  return distinct(kept.map((candidate) => candidate.row.note));
}

function contentTokens(note: string): Set<string> {
  return new Set(
    note
      .replace(/\([^)]*\)/g, ' ')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean),
  );
}

function isSubset(small: Set<string>, large: Set<string>): boolean {
  if (small.size === 0) return true;
  for (const token of small) if (!large.has(token)) return false;
  return true;
}

/** "Per night; standard room" tells us a hotel cap is nightly, not daily. */
function readBasis(notes: readonly string[]): LimitBasis | null {
  const joined = notes.join(' ').toLowerCase();
  if (/\bper night\b/.test(joined)) return 'per night';
  if (/\bper day\b/.test(joined)) return 'per day';
  return null;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function distinct<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
