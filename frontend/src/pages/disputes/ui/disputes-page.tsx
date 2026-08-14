import { Link } from 'react-router-dom';
import { DisputeStatusBadge, useDisputes } from '../../../entities/dispute';
import { paths } from '../../../app/routes/paths';
import { formatDateTime } from '../../../shared/lib';
import {
  EmptyState,
  ErrorState,
  PageHeader,
  PageSpinner,
  Table,
} from '../../../shared/ui';

// The customer's own disputes. Scoped server-side to the caller — there
// is no filter here that could widen it to somebody else's.
export function DisputesPage() {
  const { data: disputes, error, isPending, refetch } = useDisputes();

  return (
    <div>
      <PageHeader
        title="My disputes"
        subtitle="Problems you have reported, and where each one stands."
      />

      {isPending && <PageSpinner label="Loading disputes" />}
      {error && <ErrorState error={error} onRetry={() => void refetch()} />}

      {disputes && disputes.length === 0 && (
        <EmptyState
          title="No disputes"
          description="If something arrives damaged or never turns up, open a dispute from the order and it will appear here."
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
                  <Link to={paths.dispute(dispute.id)}>Open</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
