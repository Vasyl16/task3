import type { SVGProps } from 'react';

// Small inline line icons — no icon library dependency for three glyphs.
// Consistent stroke width/viewBox so they sit evenly in the header
// regardless of which one renders. `aria-hidden` by default: the
// ACCESSIBLE label belongs on the interactive element around the icon
// (a Link's aria-label), not the decorative glyph itself.
type IconProps = SVGProps<SVGSVGElement>;

function baseProps(props: IconProps): IconProps {
  return {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    ...props,
  };
}

export function CartIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <circle cx="9" cy="20" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18" cy="20" r="1.4" fill="currentColor" stroke="none" />
      <path d="M2.5 3h2l2.4 12.2a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.6L21 8H6" />
    </svg>
  );
}

export function OrdersIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M8.5 12.5h7M8.5 16h7" />
    </svg>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6.5H4c.5-1 2-2.5 2-6.5Z" />
      <path d="M10.3 19a1.9 1.9 0 0 0 3.4 0" />
    </svg>
  );
}
