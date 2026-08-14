import type { ReactNode } from 'react';

// A thin wrapper, not a data-grid abstraction: callers still write plain
// <thead>/<tbody> markup, this just owns the scroll container and the
// shared table styling so every list page doesn't repeat it.
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="ui-table-wrap">
      <table className="ui-table">{children}</table>
    </div>
  );
}
