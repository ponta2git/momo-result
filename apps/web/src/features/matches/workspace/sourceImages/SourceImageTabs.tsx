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
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
              active
                ? "border-rail-gold/70 bg-rail-gold/15 text-ink-100"
                : "border-line-soft bg-capture-black/25 text-ink-300 hover:border-white/20"
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
