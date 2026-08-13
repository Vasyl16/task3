import { IsIn, IsOptional } from 'class-validator';
import { AnalyticsPeriodQuery } from './analytics-period.query';

export const ANALYTICS_DATASETS = [
  'summary',
  'sales-chart',
  'top-products',
  'top-sellers',
] as const;
export type AnalyticsDataset = (typeof ANALYTICS_DATASETS)[number];

export const EXPORT_FORMATS = ['csv', 'json'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export class ExportQuery extends AnalyticsPeriodQuery {
  @IsIn(ANALYTICS_DATASETS)
  dataset!: AnalyticsDataset;

  @IsOptional()
  @IsIn(EXPORT_FORMATS)
  format: ExportFormat = 'csv';
}
