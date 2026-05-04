import { useEffect, useMemo, useRef, useState } from "react";

import { SourceImagePreviewDialog } from "@/features/matches/workspace/sourceImages/SourceImagePreviewDialog";
import { SourceImageTabs } from "@/features/matches/workspace/sourceImages/SourceImageTabs";
import { sourceImageKindLabels } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import type {
  SourceImageItem,
  SourceImageKind,
} from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import { toSourceImageStates } from "@/features/matches/workspace/sourceImages/sourceImageViewModel";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";

type SourceImagePanelProps = {
  loading: boolean;
  preferredKind: SourceImageKind | undefined;
  sourceImages: SourceImageItem[] | undefined;
};

const stickyDurationMs = 15_000;

export function SourceImagePanel({ loading, preferredKind, sourceImages }: SourceImagePanelProps) {
  const states = useMemo(() => toSourceImageStates(sourceImages), [sourceImages]);
  const [activeKind, setActiveKind] = useState<SourceImageKind>(preferredKind ?? "total_assets");
  const [previewKind, setPreviewKind] = useState<SourceImageKind | null>(null);
  const [manualSwitchAt, setManualSwitchAt] = useState<number>(0);
  const previewTriggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!preferredKind) {
      return;
    }

    const now = Date.now();
    if (now - manualSwitchAt <= stickyDurationMs) {
      return;
    }

    setActiveKind(preferredKind);
  }, [manualSwitchAt, preferredKind]);

  const activeState = states.find((state) => state.kind === activeKind);
  const previewUrl =
    previewKind == null
      ? undefined
      : (() => {
          const target = states.find((state) => state.kind === previewKind);
          return target?.status === "available" ? target.url : undefined;
        })();

  return (
    <Card className="h-fit rounded-2xl p-4 lg:sticky lg:top-4 lg:w-[22rem] xl:w-[26rem]">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-ink-100 text-base font-black">元画像参照</h2>
        <span className="text-ink-400 text-xs">OCR下書き正本</span>
      </div>
      <p className="text-ink-400 mt-1 text-xs">
        入力中セルに応じて既定タブを切り替えます。手動で選んだタブはしばらく固定されます。
      </p>

      <div className="mt-3">
        <SourceImageTabs
          activeKind={activeKind}
          onChange={(kind) => {
            setActiveKind(kind);
            setManualSwitchAt(Date.now());
          }}
        />
      </div>

      <div className="border-line-soft bg-capture-black/30 mt-3 rounded-xl border p-3">
        {loading ? <p className="text-ink-300 text-sm">画像を取得しています...</p> : null}

        {!loading && activeState?.status === "available" ? (
          <>
            <img
              alt={`${sourceImageKindLabels[activeState.kind]}の元画像`}
              className="h-[13rem] w-full rounded-lg bg-black/20 object-contain"
              src={activeState.url}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-ink-300 text-xs">{activeState.description}</p>
              <Button
                variant="secondary"
                onClick={(event) => {
                  previewTriggerRef.current = event.currentTarget;
                  setPreviewKind(activeState.kind);
                }}
              >
                拡大
              </Button>
            </div>
          </>
        ) : null}

        {!loading && activeState?.status === "missing" ? (
          <p className="text-ink-300 text-sm">{activeState.description}</p>
        ) : null}
      </div>

      {previewKind && previewUrl ? (
        <SourceImagePreviewDialog
          kind={previewKind}
          url={previewUrl}
          onClose={() => {
            setPreviewKind(null);
            previewTriggerRef.current?.focus();
          }}
        />
      ) : null}
    </Card>
  );
}
