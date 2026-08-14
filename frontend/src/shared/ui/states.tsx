import type { ReactNode } from 'react';
import { toUserMessage } from '../api/api-error';
import { Button } from './button';

// The three states every server-backed view needs besides its happy
// path. They live in the UI kit so "no results" never gets rendered as
// an empty list that looks like a broken page, and so a failed fetch
// always offers a way out.

export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  return (
    <div className="ui-centered-state" role="alert">
      <p>{toUserMessage(error)}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="ui-centered-state">
      <p>
        <strong>{title}</strong>
      </p>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
