import { SpinnerIcon, StatusBadge } from "momo-result-ui";

export const Sizes = () => (
  <div className="flex items-center gap-4 text-[var(--color-action)]">
    <SpinnerIcon size="sm" />
    <SpinnerIcon size="md" />
    <SpinnerIcon size="lg" />
  </div>
);

export const InlineProgress = () => (
  <div className="flex items-start gap-3">
    <span aria-hidden="true" className="mt-0.5 flex size-5 shrink-0 text-[var(--color-action)]">
      <SpinnerIcon size="lg" />
    </span>
    <p className="text-sm">スクリーンショットを読み取る準備をしています…</p>
  </div>
);

export const InBadge = () => <StatusBadge busy label="OCR解析中" tone="info" />;
