import { useId, useState } from 'react';
import { Table } from './table';

export interface BarChartPoint {
  label: string;
  value: number;
}

interface BarChartProps {
  points: BarChartPoint[];
  ariaLabel: string;
  formatValue?: (value: number) => string;
}

const CHART_HEIGHT = 160;
const BAR_GAP = 2;
const MAX_BAR_WIDTH = 24;

// A single-series bar chart, hand-built rather than pulling in a
// charting library for one dashboard widget. One hue (the app's
// primary), no legend (a single series needs none — see the dataviz
// skill's marks-and-anatomy notes), a baseline gridline, and an
// always-available table view so the data is never gated behind hover.
export function BarChart({
  points,
  ariaLabel,
  formatValue = String,
}: BarChartProps) {
  const titleId = useId();
  const [hovered, setHovered] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const maxValue = Math.max(1, ...points.map((point) => point.value));
  const bandWidth = Math.min(MAX_BAR_WIDTH, 100 / points.length);
  const barWidth = Math.max(1, bandWidth - BAR_GAP);

  return (
    <div>
      <div style={{ position: 'relative' }}>
        <svg
          role="img"
          aria-labelledby={titleId}
          viewBox={`0 0 100 ${CHART_HEIGHT}`}
          preserveAspectRatio="none"
          // No `overflow: visible` — an SVG clips to its viewBox by
          // default, and that default is what we want here: a bar
          // whose computed geometry drifts even a fraction past the
          // right edge (floating point on bandWidth * index for the
          // LAST bar especially) must never visually escape the card,
          // which is exactly what turning on `visible` used to allow.
          style={{ width: '100%', height: `${CHART_HEIGHT}px` }}
        >
          <title id={titleId}>{ariaLabel}</title>
          {/* Baseline — the one gridline this chart needs. */}
          <line
            x1={0}
            x2={100}
            y1={CHART_HEIGHT - 1}
            y2={CHART_HEIGHT - 1}
            stroke="var(--color-border)"
            strokeWidth={1}
          />
          {points.map((point, index) => {
            const barHeight = Math.max(
              1,
              (point.value / maxValue) * (CHART_HEIGHT - 8),
            );
            const bandX = Math.min(index * bandWidth, 100 - bandWidth);
            const barX = bandX + (bandWidth - barWidth) / 2;
            const y = CHART_HEIGHT - barHeight;
            const isHovered = hovered === index;
            return (
              <g key={point.label}>
                <rect
                  x={barX}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  rx={Math.min(1.5, barWidth / 2)}
                  fill="var(--color-primary)"
                  opacity={hovered === null || isHovered ? 1 : 0.55}
                  // Decorative only — the hit-testing rect below it
                  // handles hover/focus, so this must never intercept a
                  // pointer event itself (see that rect's comment).
                  pointerEvents="none"
                />
                {/* The hit target is bigger than the mark: for a
                    30-bar chart each bar is only a few pixels wide with
                    real gaps between them, and hovering imprecisely
                    near a bar's own edge (or a short bar's empty space
                    above it) was exactly what made the tooltip flicker
                    on and off. This invisible rect covers the bar's
                    FULL column — full band width, full chart height —
                    so anywhere in that column reads as "hovering this
                    bar," with no dead zone. `fill="transparent"` alone
                    would NOT receive pointer events (SVG's default
                    pointer-events mode only responds to painted area),
                    hence the explicit pointerEvents="all". */}
                <rect
                  x={bandX}
                  y={0}
                  width={bandWidth}
                  height={CHART_HEIGHT}
                  fill="transparent"
                  pointerEvents="all"
                  tabIndex={0}
                  role="graphics-symbol"
                  aria-label={`${point.label}: ${formatValue(point.value)}`}
                  onMouseEnter={() => setHovered(index)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(index)}
                  onBlur={() => setHovered(null)}
                />
              </g>
            );
          })}
        </svg>
        {hovered !== null && points[hovered] && (
          <div
            role="status"
            style={{
              position: 'absolute',
              // Same clamped bandX the hovered bar itself uses — must
              // match exactly, or the tooltip drifts away from the bar
              // it's describing for whichever bar the clamp affected
              // (in practice, only ever the last one).
              left: `${Math.min(hovered * bandWidth, 100 - bandWidth) + bandWidth / 2}%`,
              top: 0,
              transform: 'translate(-50%, -100%)',
              background: 'var(--color-text)',
              color: 'var(--color-bg)',
              padding: '4px 8px',
              borderRadius: 'var(--radius)',
              fontSize: '0.75rem',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
            }}
          >
            <strong>{formatValue(points[hovered].value)}</strong>
            <div style={{ opacity: 0.8 }}>{points[hovered].label}</div>
          </div>
        )}
      </div>

      <button
        type="button"
        className="ui-button ui-button--ghost ui-button--sm"
        onClick={() => setShowTable((current) => !current)}
        aria-expanded={showTable}
      >
        {showTable ? 'Hide data table' : 'View as table'}
      </button>

      {showTable && (
        <div style={{ marginTop: 'var(--space-2)' }}>
          <Table>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Value</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.label}>
                  <td>{point.label}</td>
                  <td>{formatValue(point.value)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </div>
  );
}
