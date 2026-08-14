import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Spinner } from './spinner';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  isLoading?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  isLoading = false,
  disabled,
  children,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      // Explicit default of "button": an unspecified <button> inside a
      // form submits it, which silently turns any incidental button into
      // a submit and is a classic source of accidental form posts.
      type={type}
      className={`ui-button ui-button--${variant}${className ? ` ${className}` : ''}`}
      // A loading button must also be inert, not merely look busy —
      // otherwise a double click sends the request twice.
      disabled={disabled ?? isLoading}
      aria-busy={isLoading}
      {...rest}
    >
      {isLoading && <Spinner label="" />}
      {children}
    </button>
  );
}
