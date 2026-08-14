interface SpinnerProps {
  size?: 'sm' | 'lg';
  // Announced to screen readers. Pass "" for a spinner sitting inside a
  // control that already has its own accessible name, so it isn't read
  // out twice.
  label?: string;
}

export function Spinner({ size = 'sm', label = 'Loading' }: SpinnerProps) {
  return (
    <span
      className={`ui-spinner${size === 'lg' ? ' ui-spinner--lg' : ''}`}
      role="status"
      aria-label={label || undefined}
      aria-hidden={label === '' ? true : undefined}
    />
  );
}

export function PageSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="ui-centered-state">
      <Spinner size="lg" label={label} />
    </div>
  );
}
