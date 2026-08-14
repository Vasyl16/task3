import type { InputHTMLAttributes } from 'react';
import { useId } from 'react';

interface CheckboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'id'
> {
  label: string;
}

// A custom-drawn checkbox rather than the bare native control — the
// native checkbox can't be restyled consistently across browsers without
// `appearance: none`, so this owns that plus the checkmark itself (a
// clip-path triangle-corner shape, no image asset). Still a real
// `<input type="checkbox">` under the hood: keyboard, screen-reader, and
// form-submission behaviour all come for free.
export function Checkbox({ label, ...rest }: CheckboxProps) {
  const id = useId();
  return (
    <label className="ui-checkbox" htmlFor={id}>
      <input type="checkbox" id={id} className="ui-checkbox__input" {...rest} />
      <span>{label}</span>
    </label>
  );
}
