interface PaginationProps {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
}

// One pager for every list. Shows the range rather than only page
// numbers, because "showing 21–40 of 57" answers the question a page
// number alone does not: how much is left.
export function Pagination({
  page,
  limit,
  total,
  onPageChange,
}: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / limit));
  // A single page of results needs no controls at all.
  if (total === 0 || pageCount === 1) return null;

  const first = (page - 1) * limit + 1;
  const last = Math.min(page * limit, total);

  return (
    <nav
      aria-label="Pagination"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-3)',
        marginTop: 'var(--space-3)',
        flexWrap: 'wrap',
      }}
    >
      <span style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
        Showing {first}–{last} of {total}
      </span>

      <div
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
      >
        <button
          type="button"
          className="ui-button ui-button--ghost"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          Previous
        </button>
        <span style={{ fontSize: '0.875rem' }}>
          Page {page} of {pageCount}
        </span>
        <button
          type="button"
          className="ui-button ui-button--ghost"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pageCount}
        >
          Next
        </button>
      </div>
    </nav>
  );
}
