import type { ReactNode } from 'react';

export type BadgeVariant = 'neutral' | 'success' | 'danger' | 'info' | 'accent';

export function Badge({
  variant = 'neutral',
  children,
}: {
  variant?: BadgeVariant;
  children: ReactNode;
}) {
  return <span className={`ui-badge ui-badge--${variant}`}>{children}</span>;
}
