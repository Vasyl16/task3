const AVATAR_HUES = [
  ['#6366f1', '#a855f7'],
  ['#0ea5e9', '#22d3ee'],
  ['#f97316', '#facc15'],
  ['#10b981', '#84cc16'],
  ['#ec4899', '#f472b6'],
  ['#8b5cf6', '#6366f1'],
] as const;

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('');
  return initials || '?';
}

// A placeholder avatar for anywhere the app names a person (a product's
// seller, a review author) but has no uploaded photo to show — initials
// on a deterministic gradient, the same technique product-card.tsx uses
// for its banner, so an identity always renders as the SAME color rather
// than a random one on every reload.
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const [from, to] = AVATAR_HUES[hashString(name) % AVATAR_HUES.length];
  return (
    <span
      aria-hidden="true"
      className="ui-avatar"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`,
      }}
    >
      {initialsOf(name)}
    </span>
  );
}
