import { formatPercentChange } from '../lib/format';

export function StatTile({
  label,
  value,
  deltaPct,
}: {
  label: string;
  value: string;
  // Omit for a stat with no period-over-period comparison.
  deltaPct?: number | null;
}) {
  const direction =
    deltaPct === undefined || deltaPct === null || deltaPct === 0
      ? 'flat'
      : deltaPct > 0
        ? 'up'
        : 'down';

  return (
    <div className="ui-stat">
      <p className="ui-stat__label">{label}</p>
      <p className="ui-stat__value">{value}</p>
      {deltaPct !== undefined && (
        <span className={`ui-stat__delta ui-stat__delta--${direction}`}>
          {formatPercentChange(deltaPct)} vs previous period
        </span>
      )}
    </div>
  );
}
