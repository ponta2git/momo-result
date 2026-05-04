import { sourceImageKindLabels } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import type { SourceImageKind } from "@/features/matches/workspace/sourceImages/sourceImageTypes";

type SourceImageTabsProps = {
  activeKind: SourceImageKind;
  onChange: (kind: SourceImageKind) => void;
};

export function SourceImageTabs({ activeKind, onChange }: SourceImageTabsProps) {
  return (
    <div role="tablist" aria-label="元画像の種別" className="flex flex-wrap gap-2">
      {(Object.keys(sourceImageKindLabels) as SourceImageKind[]).map((kind) => {
        const active = kind === activeKind;
        return (
          <button
            key={kind}
            aria-selected={active}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors duration-150 ${
              active
                ? "border-[var(--color-action)]/60 bg-[var(--color-action)]/12 text-[var(--color-text-primary)]"
                : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)]"
            }`}
            role="tab"
            type="button"
            onClick={() => onChange(kind)}
          >
            {sourceImageKindLabels[kind]}
          </button>
        );
      })}
    </div>
  );
}
