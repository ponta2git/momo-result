export function SkipLink() {
  return (
    <a
      className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[var(--z-tooltip)] focus:rounded-[var(--radius-sm)] focus:bg-[var(--color-surface)] focus:px-3 focus:py-2 focus:text-sm"
      href="#main-content"
    >
      メインコンテンツへスキップ
    </a>
  );
}
