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
  Select,
  Table,
} from '../../../shared/ui';
import { ResolveDisputeControl } from '../../../features/admin-disputes';

const STATUSES: DisputeStatus[] = [
  'OPEN',
  'UNDER_REVIEW',
  'RESOLVED',
  'REJECTED',
];

export function AdminDisputesPage() {
  const [status, setStatus] = useState<DisputeStatus | ''>('OPEN');
  const [expanded, setExpanded] = useState<string | null>(null);
  const {
    data: disputes,
    error,
    isPending,
    refetch,
  } = useAdminDisputes(status ? { status } : undefined);

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-4)', maxWidth: '240px' }}>
        <Select
          label="Status"
          value={status}
          onChange={(event) =>
            setStatus(event.target.value as DisputeStatus | '')
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
                      <ResolveDisputeControl dispute={dispute} />
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
