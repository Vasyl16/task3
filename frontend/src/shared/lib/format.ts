// Display-only formatting. The backend is the source of truth for every
// number here — these helpers parse a Decimal-as-string or ISO date
// purely to render it, never to recompute a business figure (pricing,
// totals, commission are backend-owned; see .claude/rules/frontend.md).

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

// Accepts both the Decimal-as-string shape most REST endpoints return
// and the genuine `number` the Search module returns (see
// frontend-architecture notes on the two response shapes).
export function formatMoney(
  amount: string | number | null | undefined,
): string {
  if (amount === null || amount === undefined) return '—';
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(value)) return '—';
  return currencyFormatter.format(value);
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : dateFormatter.format(date);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormatter.format(date);
}

// Signed percentage for period-over-period comparisons (analytics). null
// means "no previous-period baseline to compare against" — the backend
// returns null rather than a misleading Infinity/0, so this passes that
// through as an em dash instead of guessing.
export function formatPercentChange(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return '—';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const diffMs = date.getTime() - Date.now();
  const diffMin = Math.round(diffMs / 60_000);
  if (Math.abs(diffMin) < 1) return 'just now';
  if (Math.abs(diffMin) < 60) {
    return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
      diffMin,
      'minute',
    );
  }
  const diffHour = Math.round(diffMin / 60);
  if (Math.abs(diffHour) < 24) {
    return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
      diffHour,
      'hour',
    );
  }
  const diffDay = Math.round(diffHour / 24);
  return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
    diffDay,
    'day',
  );
}
