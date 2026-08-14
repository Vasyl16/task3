import type { TextareaHTMLAttributes } from 'react';
import { useId } from 'react';

interface TextareaProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'id'
> {
  label: string;
  error?: string;
}

export function Textarea({ label, error, ...rest }: TextareaProps) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className="ui-field__textarea"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...rest}
      />
      {error && (
        <span className="ui-field__error" id={errorId} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
