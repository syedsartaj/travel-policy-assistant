/**
 * A small RFC 4180 reader.
 *
 * Written by hand rather than pulled in as a dependency: the whole runtime here
 * is dependency-free so a reviewer can run it with nothing but Node, and the
 * subset of CSV that matters (quoted fields, embedded commas, escaped quotes,
 * CRLF) is about forty lines. A policy file with genuinely exotic CSV would be
 * a good reason to swap this for a library — the interface would not change.
 */

export interface CsvRow {
  /** 1-based line number in the original file, so diagnostics can point at it. */
  readonly line: number;
  readonly cells: readonly string[];
}

export interface CsvDocument {
  readonly header: readonly string[];
  readonly rows: readonly CsvRow[];
}

export function parseCsv(text: string): CsvDocument {
  const records = parseRecords(text.replace(/^\uFEFF/, ''));
  const [header, ...rest] = records;

  if (!header) {
    return { header: [], rows: [] };
  }

  return {
    header: header.cells.map((cell) => cell.trim()),
    // A record of one empty cell is a blank line, not a row of data.
    rows: rest.filter((row) => !(row.cells.length === 1 && row.cells[0]?.trim() === '')),
  };
}

function parseRecords(text: string): CsvRow[] {
  const records: CsvRow[] = [];
  let cells: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let recordStart = 1;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        if (char === '\n') line += 1;
        field += char;
      }
      continue;
    }

    if (char === '"' && field === '') {
      quoted = true;
    } else if (char === ',') {
      cells.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      cells.push(field);
      records.push({ line: recordStart, cells });
      cells = [];
      field = '';
      line += 1;
      recordStart = line;
    } else {
      field += char;
    }
  }

  // A final record with no trailing newline.
  if (field !== '' || cells.length > 0) {
    cells.push(field);
    records.push({ line: recordStart, cells });
  }

  return records;
}
