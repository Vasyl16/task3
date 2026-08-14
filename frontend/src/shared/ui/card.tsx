import type { HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tight?: boolean;
  interactive?: boolean;
}

export function Card({
  tight = false,
  interactive = false,
  className,
  children,
  ...rest
}: CardProps) {
  const classes = [
    'ui-card',
    tight && 'ui-card--tight',
    interactive && 'ui-card--interactive',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}
