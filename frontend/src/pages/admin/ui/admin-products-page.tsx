import { Fragment, useState } from 'react';
import type { ProductStatus } from '../../../entities/product';
import {
  ProductStatusBadge,
  useAdminProducts,
} from '../../../entities/product';
import { formatMoney } from '../../../shared/lib';
import {
  EmptyState,
  ErrorState,
  PageSpinner,
  Select,
  Table,
  TextField,
} from '../../../shared/ui';
import { ModerateProductControl } from '../../../features/admin-moderation';

const STATUSES: ProductStatus[] = ['DRAFT', 'ACTIVE', 'ARCHIVED'];

export function AdminProductsPage() {
  const [status, setStatus] = useState<ProductStatus | ''>('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const {
    data: products,
    error,
    isPending,
    refetch,
  } = useAdminProducts(status ? { status } : undefined);

  // Filtered client-side rather than as a query param: this endpoint
  // returns the whole moderation queue in one response, so the rows are
  // already here — a round trip per keystroke would buy nothing. If the
  // queue ever grows past a single response, this has to move into the
  // request, or it will only search the page it happens to have.
  //
  // Matches an id as well as a name because the thing an admin usually
  // has to hand is an id copied out of a dispute or an order line, not
  // a product name.
  const query = search.trim().toLowerCase();
  const visible = query
    ? (products ?? []).filter(
        (product) =>
          product.name.toLowerCase().includes(query) ||
          product.id.toLowerCase().includes(query) ||
          product.slug.toLowerCase().includes(query),
      )
    : products;

  return (
    <div>
      <div
        style={{
          marginBottom: 'var(--space-4)',
          display: 'flex',
          gap: 'var(--space-3)',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
        }}
      >
        <div style={{ minWidth: '20rem', flex: '1 1 20rem' }}>
          <TextField
            label="Search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Product name, id or slug"
          />
        </div>
        <div style={{ maxWidth: '240px' }}>
          <Select
            label="Status"
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as ProductStatus | '')
            }
          >
            <option value="">All</option>
            {STATUSES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {isPending && <PageSpinner label="Loading products" />}
      {error && <ErrorState error={error} onRetry={() => void refetch()} />}
      {visible && visible.length === 0 && (
        <EmptyState
          title="No products"
          description={
            query
              ? `Nothing matches “${search.trim()}”.`
              : 'Nothing matches this filter.'
          }
        />
      )}
      {visible && visible.length > 0 && (
        <Table>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Price</th>
              <th scope="col">Status</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((product) => (
              <Fragment key={product.id}>
                <tr>
                  <td>{product.name}</td>
                  <td>{formatMoney(product.basePrice)}</td>
                  <td>
                    <ProductStatusBadge status={product.status} />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="ui-button ui-button--ghost ui-button--sm"
                      onClick={() =>
                        setExpanded((current) =>
                          current === product.id ? null : product.id,
                        )
                      }
                    >
                      {expanded === product.id ? 'Close' : 'Moderate'}
                    </button>
                  </td>
                </tr>
                {expanded === product.id && (
                  <tr>
                    <td colSpan={4}>
                      <ModerateProductControl product={product} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
