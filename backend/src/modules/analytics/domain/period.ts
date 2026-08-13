import { BadRequestException } from '@nestjs/common';

// A half-open interval: [from, to). Exclusive-end is what makes the
// previous-period comparison exact — two abutting periods share a
// boundary instant without double-counting whatever landed on it.
export interface AnalyticsPeriod {
  from: Date;
  to: Date;
}

export const DEFAULT_PERIOD_DAYS = 30;
// A daily chart over a longer window would return a row per day for
// years, and every figure on the page is a full scan of that range.
// Admin-only or not, an unbounded ?from= is a trivial way to hurt the
// database.
export const MAX_PERIOD_DAYS = 366;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

// Periods are always snapped to whole UTC days. Two reasons: the daily
// sales chart's buckets then line up exactly with the period bounds (no
// half-empty first bucket), and "last 30 days" means the same thing
// whichever hour it's requested at, so the number doesn't drift while an
// admin watches it. UTC rather than a local zone because that's what
// Postgres stores — bucketing by anything else would need a timezone the
// system doesn't currently model anywhere.
export function resolvePeriod(
  input: { from?: string; to?: string } = {},
  now: Date = new Date(),
): AnalyticsPeriod {
  const today = startOfUtcDay(now);

  // `to` is the last day the caller wants INCLUDED; internally we hold
  // the exclusive instant just after it.
  const toExclusive = input.to
    ? new Date(startOfUtcDay(parseDate(input.to, 'to')).getTime() + MS_PER_DAY)
    : new Date(today.getTime() + MS_PER_DAY);

  const from = input.from
    ? startOfUtcDay(parseDate(input.from, 'from'))
    : new Date(toExclusive.getTime() - DEFAULT_PERIOD_DAYS * MS_PER_DAY);

  if (from >= toExclusive) {
    throw new BadRequestException('`from` must be earlier than `to`');
  }
  const days = Math.round(
    (toExclusive.getTime() - from.getTime()) / MS_PER_DAY,
  );
  if (days > MAX_PERIOD_DAYS) {
    throw new BadRequestException(
      `Period too long: ${days} days (maximum ${MAX_PERIOD_DAYS})`,
    );
  }

  return { from, to: toExclusive };
}

// The equally-long window immediately before this one, ending exactly
// where this one starts.
export function previousPeriod(period: AnalyticsPeriod): AnalyticsPeriod {
  const length = period.to.getTime() - period.from.getTime();
  return {
    from: new Date(period.from.getTime() - length),
    to: new Date(period.from.getTime()),
  };
}

export function periodDays(period: AnalyticsPeriod): number {
  return Math.round((period.to.getTime() - period.from.getTime()) / MS_PER_DAY);
}

// null, not Infinity or 0, when the previous period had nothing: growth
// from zero has no meaningful percentage, and reporting one (especially
// a tidy-looking 0%) would misrepresent a launch as flat. The caller
// renders null as "n/a".
export function percentChange(
  current: number,
  previous: number,
): number | null {
  if (previous === 0) {
    return null;
  }
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

function parseDate(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`\`${field}\` is not a valid date`);
  }
  return parsed;
}
