import { useState } from 'react';
import { useDisputeComments } from '../../../entities/dispute';
import type { DisputeStatus } from '../../../entities/dispute';
import { useAuth } from '../../../features/auth';
import {
  Alert,
  Button,
  ErrorState,
  Spinner,
  Textarea,
} from '../../../shared/ui';
import { useAddDisputeComment } from '../model/use-add-dispute-comment';

interface DisputeThreadProps {
  disputeId: string;
  status: DisputeStatus;
}

// The same component serves the customer and the admin. It has to: the
// backend exposes one thread with one access rule, and giving each side
// its own view would be two things to keep in step for no gain.
export function DisputeThread({ disputeId, status }: DisputeThreadProps) {
  const { user } = useAuth();
  const [body, setBody] = useState('');
  const comments = useDisputeComments(disputeId);
  const addComment = useAddDisputeComment(disputeId);

  // Mirrors the backend rule rather than replacing it — posting to a
  // decided dispute is refused server-side with a 409 regardless.
  const decided = status === 'RESOLVED' || status === 'REJECTED';

  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      {comments.isPending ? (
        <Spinner />
      ) : comments.error ? (
        <ErrorState
          error={comments.error}
          onRetry={() => void comments.refetch()}
        />
      ) : comments.data.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>
          No replies yet.
        </p>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            display: 'grid',
            gap: 'var(--space-2)',
          }}
        >
          {comments.data.map((comment) => {
            const mine = comment.authorId === user?.id;
            return (
              <li
                key={comment.id}
                style={{
                  padding: 'var(--space-2)',
                  borderRadius: 'var(--radius-sm, 6px)',
                  background: mine
                    ? 'var(--color-surface-raised, #eef2ff)'
                    : 'var(--color-surface, #f6f7f9)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '0.8rem',
                    color: 'var(--color-text-muted)',
                  }}
                >
                  <span>{mine ? 'You' : 'Support'}</span>
                  <span>{new Date(comment.createdAt).toLocaleString()}</span>
                </div>
                <p style={{ margin: '0.35rem 0 0', whiteSpace: 'pre-wrap' }}>
                  {comment.body}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {decided ? (
        <Alert variant="info">
          This dispute has been {status.toLowerCase()} and is closed to new
          replies.
        </Alert>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = body.trim();
            if (!trimmed) return;
            addComment.mutate(trimmed, { onSuccess: () => setBody('') });
          }}
          style={{ display: 'grid', gap: 'var(--space-2)' }}
        >
          <Textarea
            label="Add a reply"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
            placeholder="Add anything that helps resolve this…"
          />
          {addComment.isError && (
            <Alert variant="error">
              {addComment.error instanceof Error
                ? addComment.error.message
                : 'Could not post your reply.'}
            </Alert>
          )}
          <Button
            type="submit"
            disabled={body.trim().length < 2 || addComment.isPending}
          >
            {addComment.isPending ? 'Sending…' : 'Send reply'}
          </Button>
        </form>
      )}
    </div>
  );
}
