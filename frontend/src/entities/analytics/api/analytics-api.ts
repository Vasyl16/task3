import { api } from '../../../shared/api';
import { ApiError } from '../../../shared/api';
import type { QueryParams } from '../../../shared/api';
import { env } from '../../../shared/config/env';
import { tokenStorage } from '../../../shared/lib';
import type {
  AnalyticsPeriodQuery,
  ExportQuery,
  PlatformAnalyticsReport,
  SellerAnalyticsReport,
} from '../model/analytics';

function filenameFromContentDisposition(header: string | null): string | null {
  const match = header?.match(/filename="?([^";]+)"?/);
  return match?.[1] ?? null;
}

export const analyticsApi = {
  mySellerReport: (query?: AnalyticsPeriodQuery) =>
    api.get<SellerAnalyticsReport>('/analytics/me/seller', {
      params: query as QueryParams,
    }),

  adminReport: (query?: AnalyticsPeriodQuery) =>
    api.get<PlatformAnalyticsReport>('/admin/analytics', {
      params: query as QueryParams,
    }),

  // The export endpoint returns a raw file stream (Content-Disposition:
  // attachment), not JSON — apiRequest always calls response.json(), so
  // this goes around it with a plain fetch and triggers a browser
  // download directly.
  adminExport: async (query: ExportQuery): Promise<void> => {
    const url = new URL(
      'admin/analytics/export',
      `${env.apiUrl.replace(/\/$/, '')}/`,
    );
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const accessToken = tokenStorage.getAccessToken();
    const response = await fetch(url.toString(), {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    });

    if (!response.ok) {
      throw new ApiError(response.status, ['Export failed']);
    }

    const blob = await response.blob();
    const filename =
      filenameFromContentDisposition(
        response.headers.get('Content-Disposition'),
      ) ?? `analytics-${query.dataset}.${query.format ?? 'csv'}`;

    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  },
};

export const analyticsKeys = {
  all: ['analytics'] as const,
  mySeller: (query?: AnalyticsPeriodQuery) =>
    [...analyticsKeys.all, 'seller', query ?? {}] as const,
  admin: (query?: AnalyticsPeriodQuery) =>
    [...analyticsKeys.all, 'admin', query ?? {}] as const,
};
