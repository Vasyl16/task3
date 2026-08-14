import { useState } from 'react';
import type { Dispute, DisputeStatus } from '../../../entities/dispute';
import { Button, ErrorAlert, Textarea } from '../../../shared/ui';
import { useResolveDispute } from '../model/use-resolve-dispute';

const TERMINAL: DisputeStatus[] = ['RESOLVED', 'REJECTED'];

export function ResolveDisputeControl({ dispute }: { dispute: Dispute }) {
  const resolveDispute = useResolveDispute();
  const [resolution, setResolution] = useState(dispute.resolution ?? '');
  const [attempted, setAttempted] = useState<DisputeStatus | null>(null);

  if (dispute.status === 'RESOLVED' || dispute.status === 'REJECTED') {
    return null;
  }

  const submit = (status: DisputeStatus) => {
    // Required by the backend for RESOLVED/REJECTED, optional otherwise
    // — mirrored here purely so the error shows before the round trip.
    if (TERMINAL.includes(status) && resolution.trim().length === 0) {
      setAttempted(status);
      return;
    }
    resolveDispute.mutate({
      disputeId: dispute.id,
      input: { status, resolution: resolution.trim() || undefined },
    });
  };

  return (
    <div>
      <ErrorAlert error={resolveDispute.error} />
      <Textarea
        label="Resolution notes (required to resolve or reject)"
        value={resolution}
        onChange={(event) => setResolution(event.target.value)}
        error={
          attempted && resolution.trim().length === 0
            ? 'Resolution notes are required'
            : undefined
        }
      />
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        {dispute.status === 'OPEN' && (
          <Button
            variant="secondary"
            isLoading={resolveDispute.isPending}
            onClick={() => submit('UNDER_REVIEW')}
          >
            Mark under review
          </Button>
        )}
        <Button
          isLoading={resolveDispute.isPending}
          onClick={() => submit('RESOLVED')}
        >
          Resolve
        </Button>
        <Button
          variant="danger"
          isLoading={resolveDispute.isPending}
          onClick={() => submit('REJECTED')}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}
