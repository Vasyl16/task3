import { BadRequestException } from '@nestjs/common';
import {
  MAX_PERIOD_DAYS,
  percentChange,
  periodDays,
  previousPeriod,
  resolvePeriod,
} from './period';

// A deliberately awkward "now": mid-afternoon, so any test that passes
// only because the clock happened to be at midnight fails here.
const NOW = new Date('2026-08-13T14:37:52.123Z');

describe('resolvePeriod', () => {
  it('defaults to the last 30 whole UTC days, ending at the end of today', () => {
    const period = resolvePeriod({}, NOW);

    expect(period.from.toISOString()).toBe('2026-07-15T00:00:00.000Z');
    expect(period.to.toISOString()).toBe('2026-08-14T00:00:00.000Z');
    expect(periodDays(period)).toBe(30);
  });

  // Otherwise "last 30 days" would mean something slightly different
  // every time the page was refreshed, and two figures fetched a minute
  // apart would cover different windows.
  it('snaps to day boundaries so the same request is stable through the day', () => {
    const morning = resolvePeriod({}, new Date('2026-08-13T00:00:01.000Z'));
    const evening = resolvePeriod({}, new Date('2026-08-13T23:59:59.000Z'));

    expect(morning).toEqual(evening);
  });

  it('treats an explicit `to` as inclusive of that whole day', () => {
    const period = resolvePeriod({ from: '2026-08-01', to: '2026-08-07' }, NOW);

    expect(period.from.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    // Exclusive end — the instant after 2026-08-07 ends.
    expect(period.to.toISOString()).toBe('2026-08-08T00:00:00.000Z');
    expect(periodDays(period)).toBe(7);
  });

  it('ignores a time component on an explicit bound', () => {
    const period = resolvePeriod(
      { from: '2026-08-01T18:22:00Z', to: '2026-08-07T04:00:00Z' },
      NOW,
    );

    expect(period.from.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(period.to.toISOString()).toBe('2026-08-08T00:00:00.000Z');
  });

  it('rejects a reversed range', () => {
    expect(() =>
      resolvePeriod({ from: '2026-08-07', to: '2026-08-01' }, NOW),
    ).toThrow(BadRequestException);
  });

  it('rejects an unparseable date rather than silently defaulting', () => {
    expect(() => resolvePeriod({ from: 'last-tuesday' }, NOW)).toThrow(
      BadRequestException,
    );
  });

  // Every figure on the report is a full aggregate over the range, and
  // the chart returns a row per day — an unbounded `from` is an easy way
  // to make the database do a great deal of work.
  it('rejects a period longer than the cap', () => {
    expect(() =>
      resolvePeriod({ from: '2020-01-01', to: '2026-01-01' }, NOW),
    ).toThrow(BadRequestException);
  });

  it('accepts a period exactly at the cap', () => {
    const period = resolvePeriod({ from: '2025-08-14', to: '2026-08-13' }, NOW);

    expect(periodDays(period)).toBe(MAX_PERIOD_DAYS - 1);
  });
});

describe('previousPeriod', () => {
  it('is the same length and ends exactly where the current period starts', () => {
    const current = resolvePeriod(
      { from: '2026-08-08', to: '2026-08-14' },
      NOW,
    );
    const previous = previousPeriod(current);

    // 2026-08-08 through 2026-08-14 inclusive is 7 days, so the
    // preceding 7 days are 2026-08-01 through 2026-08-07.
    expect(periodDays(current)).toBe(7);
    expect(previous.to).toEqual(current.from);
    expect(periodDays(previous)).toBe(periodDays(current));
    expect(previous.from.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  // The two windows abut without overlapping: because both intervals are
  // half-open, the boundary instant belongs to the current period only,
  // so nothing is counted in both halves of the comparison.
  it('does not overlap the current period', () => {
    const current = resolvePeriod({}, NOW);
    const previous = previousPeriod(current);

    expect(previous.to.getTime()).toBe(current.from.getTime());
    expect(previous.from.getTime()).toBeLessThan(previous.to.getTime());
  });

  it('spans a month boundary correctly', () => {
    const current = resolvePeriod(
      { from: '2026-03-01', to: '2026-03-31' },
      NOW,
    );
    const previous = previousPeriod(current);

    expect(periodDays(current)).toBe(31);
    expect(previous.from.toISOString()).toBe('2026-01-29T00:00:00.000Z');
    expect(previous.to.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });
});

describe('percentChange', () => {
  it('reports growth to one decimal place', () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(133, 100)).toBe(33);
    expect(percentChange(100.5, 100)).toBe(0.5);
  });

  it('reports a decline as a negative', () => {
    expect(percentChange(75, 100)).toBe(-25);
  });

  it('reports no movement as zero', () => {
    expect(percentChange(100, 100)).toBe(0);
  });

  // Not Infinity, and specifically not 0 — a tidy-looking 0% would read
  // as "flat" on a dashboard when what actually happened is that the
  // marketplace went from nothing to something.
  it('returns null when the previous period was zero', () => {
    expect(percentChange(500, 0)).toBeNull();
    expect(percentChange(0, 0)).toBeNull();
  });

  it('handles a drop to zero', () => {
    expect(percentChange(0, 200)).toBe(-100);
  });
});
