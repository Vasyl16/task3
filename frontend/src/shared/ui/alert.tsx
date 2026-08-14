import { isApiError, toUserMessage } from '../api/api-error';

interface AlertProps {
  variant?: 'error' | 'info';
  children: React.ReactNode;
}

export function Alert({ variant = 'info', children }: AlertProps) {
  return (
    <div
      className={`ui-alert ui-alert--${variant}`}
      // Errors interrupt; informational text waits for a pause.
      role={variant === 'error' ? 'alert' : 'status'}
    >
      {children}
    </div>
  );
}

// Renders whatever a mutation or query threw. A 400 from class-validator
// carries one message per failed constraint, so all of them are listed
// rather than only the first — otherwise a user fixes one problem,
// resubmits, and is told about the next one.
export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;

  const extra =
    isApiError(error) && error.messages.length > 1
      ? error.messages.slice(1)
      : [];

  return (
    <Alert variant="error">
      {toUserMessage(error)}
      {extra.length > 0 && (
        <ul className="ui-alert__list">
          {extra.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
    </Alert>
  );
}
