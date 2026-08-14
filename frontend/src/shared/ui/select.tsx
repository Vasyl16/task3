import type { SelectHTMLAttributes } from 'react';
import { useId } from 'react';

interface SelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'id'
> {
  label: string;
  error?: string;
}

export function Select({ label, error, children, ...rest }: SelectProps) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="ui-field__select"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...rest}
      >
        {children}
      </select>
      {error && (
        <span className="ui-field__error" id={errorId} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
