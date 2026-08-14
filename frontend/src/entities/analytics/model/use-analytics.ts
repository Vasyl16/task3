import { useMutation, useQuery } from '@tanstack/react-query';
import { analyticsApi, analyticsKeys } from '../api/analytics-api';
import type { AnalyticsPeriodQuery, ExportQuery } from './analytics';

export function useMySellerAnalytics(query?: AnalyticsPeriodQuery) {
  return useQuery({
    queryKey: analyticsKeys.mySeller(query),
    queryFn: () => analyticsApi.mySellerReport(query),
  });
}

export function useAdminAnalytics(query?: AnalyticsPeriodQuery) {
  return useQuery({
    queryKey: analyticsKeys.admin(query),
    queryFn: () => analyticsApi.adminReport(query),
  });
}

export function useExportAnalytics() {
  return useMutation({
    mutationFn: (query: ExportQuery) => analyticsApi.adminExport(query),
  });
}
