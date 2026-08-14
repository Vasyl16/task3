import type { ReactNode } from 'react';
import { BrandMark } from './brand-mark';

// A single centered card for one-thing-at-a-time pages (sign in,
// register) — its own component rather than a `<Card>` plus ad-hoc
// centering at each call site, since the brand header above the card is
// shared between both auth screens.
export function CenteredPage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="centered-page">
      <div className="centered-page__card ui-card">
        <div className="centered-page__brand">
          <BrandMark size={44} />
          <h1>{title}</h1>
        </div>
        {children}
      </div>
    </div>
  );
}
