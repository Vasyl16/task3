export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="ui-brand-mark"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
    >
      M
    </span>
  );
}
