export type CsvValue = string | number | null | undefined;
export type CsvRow = Record<string, CsvValue>;

// Leading =, +, -, @ (and tab/CR, which Excel strips before parsing) make
// a spreadsheet treat the cell as a formula. A seller who names their
// shop `=HYPERLINK(...)` would otherwise get that formula executed inside
// an admin's Excel the moment they open an export. Prefixing with a
// single quote makes it literal text everywhere.
const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

function escapeCell(value: CsvValue): string {
  if (value === null || value === undefined) {
    return '';
  }
  let text = String(value);
  if (FORMULA_PREFIXES.includes(text.charAt(0))) {
    text = `'${text}`;
  }
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

// RFC 4180: CRLF line endings, quotes doubled inside quoted fields.
// Columns are passed explicitly rather than inferred from the first row,
// so a row with a missing key produces an empty cell instead of silently
// shifting every later column left.
export function toCsv(rows: CsvRow[], columns: string[]): string {
  const lines = [columns.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => escapeCell(row[column])).join(','));
  }
  return lines.join('\r\n');
}
