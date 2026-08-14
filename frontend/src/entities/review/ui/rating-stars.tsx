interface RatingStarsProps {
  // Nullable on purpose: search hits carry no rating until the product
  // has been indexed since reviews were added, so this arrives undefined
  // from a stale document. Treated as "unrated" rather than trusted to
  // be a number — a display primitive should not be able to take a page
  // down over a missing field.
  value: number | null | undefined;
  count?: number;
  size?: 'sm' | 'md';
  // When set, the stars become a radio group and clicking one selects
  // that rating. Read-only display is the default.
  onChange?: (rating: number) => void;
}

const STARS = [1, 2, 3, 4, 5];

// Identity is never carried by colour alone: the numeric value sits
// beside the stars, and the accessible name spells the rating out, so a
// screen reader and a monochrome display both still convey it.
export function RatingStars({
  value,
  count,
  size = 'sm',
  onChange,
}: RatingStarsProps) {
  const dimension = size === 'md' ? '1.5rem' : '1.05rem';
  const interactive = Boolean(onChange);
  const rating =
    typeof value === 'number' && Number.isFinite(value) ? value : 0;
  // A missing rating and an explicit zero-review count read the same to
  // a shopper: nothing to show yet.
  const unrated = rating === 0 || count === 0;

  return (
    <span
      role={interactive ? 'radiogroup' : 'img'}
      aria-label={
        interactive
          ? 'Choose a rating from 1 to 5'
          : unrated
            ? 'No reviews yet'
            : `Rated ${rating} out of 5${count ? ` from ${count} reviews` : ''}`
      }
      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
    >
      <span
        style={{ display: 'inline-flex', gap: '0.1rem' }}
        aria-hidden="true"
      >
        {STARS.map((star) => {
          const filled = star <= Math.round(rating);
          const style = {
            width: dimension,
            height: dimension,
            lineHeight: 1,
            fontSize: dimension,
            color: filled
              ? 'var(--color-warning, #e0a800)'
              : 'var(--color-border, #c9ccd4)',
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: interactive ? 'pointer' : 'default',
          } as const;

          return interactive ? (
            <button
              key={star}
              type="button"
              role="radio"
              aria-checked={star === Math.round(rating)}
              aria-label={`${star} star${star === 1 ? '' : 's'}`}
              onClick={() => onChange?.(star)}
              style={style}
            >
              ★
            </button>
          ) : (
            <span key={star} style={style}>
              ★
            </span>
          );
        })}
      </span>
      {!interactive && (
        <span
          style={{
            fontSize: '0.85rem',
            color: 'var(--color-text-muted, #6b7280)',
          }}
        >
          {unrated
            ? 'No reviews yet'
            : `${rating.toFixed(1)}${count ? ` (${count})` : ''}`}
        </span>
      )}
    </span>
  );
}
