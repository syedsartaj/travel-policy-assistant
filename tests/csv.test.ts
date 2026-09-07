import { describe, expect, it } from 'vitest';

import { parseCsv } from '../src/policy/csv.js';

describe('parseCsv', () => {
  it('reads a header and rows, keeping the source line number', () => {
    const doc = parseCsv('a,b\n1,2\n3,4\n');

    expect(doc.header).toEqual(['a', 'b']);
    expect(doc.rows).toEqual([
      { line: 2, cells: ['1', '2'] },
      { line: 3, cells: ['3', '4'] },
    ]);
  });

  it('keeps commas and quotes that are inside a quoted field', () => {
    const doc = parseCsv('a,b\n"one, two","he said ""hi"""\n');

    expect(doc.rows[0]?.cells).toEqual(['one, two', 'he said "hi"']);
  });

  it('handles CRLF line endings and a missing final newline', () => {
    const doc = parseCsv('a,b\r\n1,2\r\n3,4');

    expect(doc.rows.map((row) => row.cells)).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('keeps empty cells rather than dropping them', () => {
    const doc = parseCsv('a,b,c\n1,,3\n');

    expect(doc.rows[0]?.cells).toEqual(['1', '', '3']);
  });

  it('skips blank lines but still counts them, so line numbers stay true', () => {
    const doc = parseCsv('a,b\n1,2\n\n3,4\n');

    expect(doc.rows).toEqual([
      { line: 2, cells: ['1', '2'] },
      { line: 4, cells: ['3', '4'] },
    ]);
  });

  it('strips a byte order mark left by a spreadsheet export', () => {
    const doc = parseCsv('﻿category,region\nMeals,India\n');

    expect(doc.header).toEqual(['category', 'region']);
  });

  it('returns nothing for an empty file instead of throwing', () => {
    expect(parseCsv('')).toEqual({ header: [], rows: [] });
  });
});
