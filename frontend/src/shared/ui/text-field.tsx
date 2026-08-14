import type { InputHTMLAttributes } from 'react';
import { useId } from 'react';

interface TextFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'id'
> {
  label: string;
  error?: string;
}

// A plain forwardRef-free input: React 19 passes `ref` through as a
// normal prop, so React Hook Form's `{...register()}` (which includes a
// ref) spreads onto the element directly.
export function TextField({ label, error, ...rest }: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={`ui-field__input${error ? ' ui-field__input--invalid' : ''}`}
        // Without these two, a screen-reader user gets no indication that
        // the field is invalid or why — the red border is visual-only.
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
