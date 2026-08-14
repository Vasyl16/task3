import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { DisputeStatus } from '../../../entities/dispute';
import {
  DisputeStatusBadge,
  useSellerDisputes,
} from '../../../entities/dispute';
import { paths } from '../../../app/routes/paths';
import { formatDateTime } from '../../../shared/lib';
import {
  EmptyState,
  ErrorState,
  PageHeader,
  PageSpinner,
  Pagination,
  Select,
  Table,
  TextField,
} from '../../../shared/ui';

const STATUSES: DisputeStatus[] = [
  'OPEN',
  'UNDER_REVIEW',
  'RESOLVED',
  'REJECTED',
];

// Complaints raised against this seller's own shipments. Scoped
// server-side to their approved profile — there is no sellerId parameter
// that could be pointed at another seller.
//
// Opening one leads to the same detail page a customer sees — subject,
// reason, resolution once ruled, and the conversation — where a seller
// can read what was said and reply on their own thread. Ruling on it is
// still admin-only: no resolve control is offered here or on that page
// for a seller, and the backend would refuse it regardless. A seller who
// could decide their own disputes would make the whole process
// meaningless; what they get is visibility and a voice in the case.
export function SellerDisputesPage() {
  const [status, setStatus] = useState<DisputeStatus | ''>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data, error, isPending, refetch } = useSellerDisputes({
    ...(status ? { status } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
    page,
  });
  const disputes = data?.items;

  return (
    <div>
      <PageHeader
        title="Disputes"
        subtitle="Problems buyers have reported with your shipments. An admin decides the outcome."
      />

      <div
        style={{
          marginBottom: 'var(--space-3)',
          display: 'flex',
          gap: 'var(--space-3)',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
        }}
      >
        <div style={{ minWidth: '18rem', flex: '1 1 18rem' }}>
          <TextField
            label="Search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Dispute id or reason"
          />
        </div>
        <div style={{ maxWidth: '14rem' }}>
          <Select
            label="Status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as DisputeStatus | '');
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

      {isPending && <PageSpinner label="Loading disputes" />}
      {error && <ErrorState error={error} onRetry={() => void refetch()} />}

      {disputes && disputes.length === 0 && (
        <EmptyState
          title="No disputes"
          description={
            search.trim()
              ? `Nothing matches “${search.trim()}”.`
              : 'Nothing has been disputed on your shipments.'
          }
        />
      )}

      {disputes && disputes.length > 0 && (
        <Table>
          <thead>
            <tr>
              <th scope="col">Opened</th>
              <th scope="col">Scope</th>
              <th scope="col">Reason</th>
              <th scope="col">Status</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {disputes.map((dispute) => (
              <tr key={dispute.id}>
                <td>{formatDateTime(dispute.createdAt)}</td>
                <td>{dispute.orderItemId ? 'One item' : 'Whole shipment'}</td>
                <td style={{ maxWidth: '360px' }}>{dispute.reason}</td>
                <td>
                  <DisputeStatusBadge status={dispute.status} />
                </td>
                <td>
                  <Link to={paths.seller.dispute(dispute.id)}>Open</Link>
                </td>
              </tr>
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
