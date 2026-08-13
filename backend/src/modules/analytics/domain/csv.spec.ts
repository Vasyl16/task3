import { toCsv } from './csv';

describe('toCsv', () => {
  it('writes a header row followed by one row per record, CRLF separated', () => {
    const csv = toCsv(
      [
        { date: '2026-08-01', netSales: '10.00' },
        { date: '2026-08-02', netSales: '20.00' },
      ],
      ['date', 'netSales'],
    );

    expect(csv).toBe('date,netSales\r\n2026-08-01,10.00\r\n2026-08-02,20.00');
  });

  it('emits only the header when there are no rows', () => {
    expect(toCsv([], ['date', 'netSales'])).toBe('date,netSales');
  });

  // A row missing a key must produce an empty cell, not shift every
  // later column one position to the left.
  it('renders a missing or null field as an empty cell', () => {
    const csv = toCsv(
      [
        { a: '1', c: '3' },
        { a: '1', b: null, c: '3' },
      ],
      ['a', 'b', 'c'],
    );

    expect(csv).toBe('a,b,c\r\n1,,3\r\n1,,3');
  });

  it('quotes and escapes fields containing commas, quotes or newlines', () => {
    const csv = toCsv(
      [
        { name: 'Acme, Inc.' },
        { name: 'The "Best" Shop' },
        { name: 'Line one\nLine two' },
      ],
      ['name'],
    );

    expect(csv).toBe(
      'name\r\n"Acme, Inc."\r\n"The ""Best"" Shop"\r\n"Line one\nLine two"',
    );
  });

  // CSV injection: Excel and Sheets evaluate a cell beginning with =, +,
  // - or @ as a formula. Business names are attacker-controlled (a seller
  // picks their own), and this export is opened by an admin — exactly the
  // high-privilege target that makes the payload worth planting.
  it('neutralises formula-triggering leading characters', () => {
    const csv = toCsv(
      [
        { name: '=HYPERLINK("http://evil.example","click")' },
        { name: '+1234' },
        { name: '-1234' },
        { name: '@SUM(A1:A9)' },
      ],
      ['name'],
    );

    const rows = csv.split('\r\n').slice(1);
    expect(rows[0]).toBe(`"'=HYPERLINK(""http://evil.example"",""click"")"`);
    expect(rows[1]).toBe(`'+1234`);
    expect(rows[2]).toBe(`'-1234`);
    expect(rows[3]).toBe(`'@SUM(A1:A9)`);
  });

  it('leaves an ordinary negative number readable while still escaping it', () => {
    // The trade-off is accepted deliberately: a genuine "-25.5" is
    // prefixed too. Correctly-read data beats an executable spreadsheet.
    expect(toCsv([{ v: '-25.5' }], ['v'])).toBe(`v\r\n'-25.5`);
  });

  it('writes numbers and zero without quoting', () => {
    expect(toCsv([{ n: 0, m: 42 }], ['n', 'm'])).toBe('n,m\r\n0,42');
  });
});
