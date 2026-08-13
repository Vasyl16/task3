import { IsISO8601, IsOptional } from 'class-validator';

// Both optional: with neither, the period defaults to the last 30 UTC
// days, which is the "sales chart for last 30 days" the spec asks for.
// Bounds are snapped to whole UTC days and length-capped in
// resolvePeriod — see domain/period.ts.
export class AnalyticsPeriodQuery {
  @IsOptional()
  @IsISO8601()
  from?: string;

  // Inclusive: the last day to report on.
  @IsOptional()
  @IsISO8601()
  to?: string;
}
