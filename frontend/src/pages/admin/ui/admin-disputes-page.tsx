import { Fragment, useState } from 'react';
import type { DisputeStatus } from '../../../entities/dispute';
import {
  DisputeStatusBadge,
  useAdminDisputes,
} from '../../../entities/dispute';
import { formatDateTime } from '../../../shared/lib';
import {
  EmptyState,
  ErrorState,
  PageSpinner,
  Pagination,
  Select,
  Table,
} from '../../../shared/ui';
import { ResolveDisputeControl } from '../../../features/admin-disputes';
import { DisputeThread } from '../../../widgets/dispute-thread';
import { useDispute } from '../../../entities/dispute';
import { DisputeSubject } from '../../../widgets/dispute-subject';
import { Spinner } from '../../../shared/ui';

const STATUSES: DisputeStatus[] = [
  'OPEN',
  'UNDER_REVIEW',
  'RESOLVED',
  'REJECTED',
];

export function AdminDisputesPage() {
  const [status, setStatus] = useState<DisputeStatus | ''>('OPEN');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const { data, error, isPending, refetch } = useAdminDisputes({
    ...(status ? { status } : {}),
    page,
  });
  const disputes = data?.items;

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-4)', maxWidth: '240px' }}>
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

      {isPending && <PageSpinner label="Loading disputes" />}
      {error && <ErrorState error={error} onRetry={() => void refetch()} />}
      {disputes && disputes.length === 0 && (
        <EmptyState
          title="No disputes"
          description="Nothing matches this filter."
        />
      )}
      {disputes && disputes.length > 0 && (
        <Table>
          <thead>
            <tr>
              <th scope="col">Seller order</th>
              <th scope="col">Reason</th>
              <th scope="col">Raised</th>
              <th scope="col">Status</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {disputes.map((dispute) => (
              <Fragment key={dispute.id}>
                <tr>
                  <td>{dispute.sellerOrderId.slice(0, 8)}</td>
                  <td style={{ maxWidth: '320px' }}>{dispute.reason}</td>
                  <td>{formatDateTime(dispute.createdAt)}</td>
                  <td>
                    <DisputeStatusBadge status={dispute.status} />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="ui-button ui-button--ghost ui-button--sm"
                      onClick={() =>
                        setExpanded((current) =>
                          current === dispute.id ? null : dispute.id,
                        )
                      }
                    >
                      {expanded === dispute.id ? 'Close' : 'Review'}
                    </button>
                  </td>
                </tr>
                {expanded === dispute.id && (
                  <tr>
                    <td colSpan={5}>
                      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
                        {/* What the complaint is actually about, and a
                            way through to the order — an admin should
                            not have to rule on "it was damaged" without
                            seeing which item, or leave this page to act
                            on the shipment. */}
                        <AdminDisputeSubject disputeId={dispute.id} />
                        {/* The conversation first, then the ruling —
                            an admin should read what was argued before
                            deciding, not after. */}
                        <DisputeThread
                          disputeId={dispute.id}
                          status={dispute.status}
                        />
                        <ResolveDisputeControl dispute={dispute} />
                      </div>
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

// Fetched per expanded row rather than with the list: the queue can be
// long, and the order context is only needed for the one being worked
// on. GET /disputes/:id carries the same access rule the list does.
function AdminDisputeSubject({ disputeId }: { disputeId: string }) {
  const { data: dispute, isPending } = useDispute(disputeId);
  if (isPending) return <Spinner />;
  if (!dispute) return null;
  return <DisputeSubject dispute={dispute} />;
}
