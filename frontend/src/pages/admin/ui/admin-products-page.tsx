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
  Pagination,
  Table,
  TextField,
} from '../../../shared/ui';
import { ModerateProductControl } from '../../../features/admin-moderation';

const STATUSES: ProductStatus[] = ['DRAFT', 'ACTIVE', 'ARCHIVED'];

export function AdminProductsPage() {
  const [status, setStatus] = useState<ProductStatus | ''>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data, error, isPending, refetch } = useAdminProducts({
    ...(status ? { status } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
    page,
  });

  const products = data?.items;

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
            onChange={(event) => {
              setSearch(event.target.value);
              // A new search starts at the beginning; staying on page 4
              // of the previous result set would usually show nothing.
              setPage(1);
            }}
            placeholder="Product name, id or slug"
          />
        </div>
        <div style={{ maxWidth: '240px' }}>
          <Select
            label="Status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as ProductStatus | '');
              setPage(1);
            }}
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
      {products && products.length === 0 && (
        <EmptyState
          title="No products"
          description={
            search.trim()
              ? `Nothing matches “${search.trim()}”.`
              : 'Nothing matches this filter.'
          }
        />
      )}
      {products && products.length > 0 && (
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
            {products.map((product) => (
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

      {data && (
        <Pagination
          page={data.page}
          limit={data.limit}
          total={data.total}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
