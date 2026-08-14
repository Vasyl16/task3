import { useParams } from 'react-router-dom';
import { DisputeStatusBadge, useDispute } from '../../../entities/dispute';
import { formatDateTime } from '../../../shared/lib';
import { Card, ErrorState, PageHeader, PageSpinner } from '../../../shared/ui';
import { DisputeSubject } from '../../../widgets/dispute-subject';
import { DisputeThread } from '../../../widgets/dispute-thread';

// The customer's side of one dispute: what it is about, what they said,
// and the conversation with support. The ruling itself is an admin
// action and appears here only as a result.
export function DisputeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: dispute, error, isPending, refetch } = useDispute(id);

  if (isPending) return <PageSpinner label="Loading dispute" />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!dispute) return null;

  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <PageHeader
        title={`Dispute ${dispute.id.slice(0, 8)}`}
        subtitle={`Opened ${formatDateTime(dispute.createdAt)}`}
        actions={<DisputeStatusBadge status={dispute.status} />}
      />

      <Card>
        <DisputeSubject dispute={dispute} />
        <p style={{ marginTop: 'var(--space-3)', whiteSpace: 'pre-wrap' }}>
          {dispute.reason}
        </p>
      </Card>

      {dispute.resolution && (
        <Card>
          <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Outcome</h2>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
            {dispute.resolution}
          </p>
        </Card>
      )}

      <Card>
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Conversation</h2>
        <DisputeThread disputeId={dispute.id} status={dispute.status} />
      </Card>
    </div>
  );
}
