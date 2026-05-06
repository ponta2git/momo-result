import { useEffect, useMemo, useRef, useState } from "react";

import { downloadMatchDraftSourceImage } from "@/features/matches/workspace/api";
import { SourceImagePreviewDialog } from "@/features/matches/workspace/sourceImages/SourceImagePreviewDialog";
import { SourceImageTabs } from "@/features/matches/workspace/sourceImages/SourceImageTabs";
import { sourceImageKindLabels } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import type {
  SourceImageItem,
  SourceImageKind,
} from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import { toSourceImageStates } from "@/features/matches/workspace/sourceImages/sourceImageViewModel";
import { Button } from "@/shared/ui/actions/Button";
import { Card } from "@/shared/ui/layout/Card";

type SourceImagePanelProps = {
  loading: boolean;
  preferredKind: SourceImageKind | undefined;
  sourceImages: SourceImageItem[] | undefined;
};

const stickyDurationMs = 15_000;

type LoadedSourceImage =
  | { status: "idle" }
  | { status: "loading"; url: string }
  | { objectUrl: string; status: "ready"; url: string }
  | { status: "error"; url: string };

export function SourceImagePanel({ loading, preferredKind, sourceImages }: SourceImagePanelProps) {
  const states = useMemo(() => toSourceImageStates(sourceImages), [sourceImages]);
  const [activeKind, setActiveKind] = useState<SourceImageKind>(preferredKind ?? "total_assets");
  const [previewKind, setPreviewKind] = useState<SourceImageKind | null>(null);
  const [manualSwitchAt, setManualSwitchAt] = useState<number>(0);
  const [loadedImage, setLoadedImage] = useState<LoadedSourceImage>({ status: "idle" });
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
  const activeImageUrl = activeState?.status === "available" ? activeState.url : undefined;
  const displayUrl =
    loadedImage.status === "ready" && loadedImage.url === activeImageUrl
      ? loadedImage.objectUrl
      : undefined;
  const previewUrl = previewKind === activeKind ? displayUrl : undefined;

  useEffect(() => {
    if (!activeImageUrl) {
      setLoadedImage({ status: "idle" });
      return;
    }

    const controller = new AbortController();
    let objectUrl: string | undefined;

    const loadImage = async () => {
      try {
        const blob = await downloadMatchDraftSourceImage(activeImageUrl, controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setLoadedImage({ objectUrl, status: "ready", url: activeImageUrl });
      } catch {
        if (controller.signal.aborted) {
          return;
        }
        setLoadedImage({ status: "error", url: activeImageUrl });
      }
    };

    setLoadedImage({ status: "loading", url: activeImageUrl });
    void loadImage();

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [activeImageUrl]);

  return (
    <Card className="h-fit p-4 lg:sticky lg:top-4 lg:w-[22rem] xl:w-[26rem]">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">元画像参照</h2>
        <span className="text-xs text-[var(--color-text-secondary)]">OCR下書き正本</span>
      </div>
      <p className="mt-1 text-xs text-pretty text-[var(--color-text-secondary)]">
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

      <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3">
        {loading ? (
          <p className="text-sm text-[var(--color-text-secondary)]">画像を取得しています...</p>
        ) : null}

        {!loading && activeState?.status === "available" && loadedImage.status === "loading" ? (
          <p className="text-sm text-[var(--color-text-secondary)]">画像を読み込んでいます...</p>
        ) : null}

        {!loading && activeState?.status === "available" && loadedImage.status === "error" ? (
          <p className="text-sm text-[var(--color-danger)]">
            元画像を読み込めませんでした。時間をおいて再度開いてください。
          </p>
        ) : null}

        {!loading && activeState?.status === "available" && displayUrl ? (
          <>
            <img
              alt={`${sourceImageKindLabels[activeState.kind]}の元画像`}
              className="h-[13rem] w-full rounded-[var(--radius-sm)] bg-[var(--momo-night-900)] object-contain"
              src={displayUrl}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-xs text-[var(--color-text-secondary)]">
                {activeState.description}
              </p>
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
          <p className="text-sm text-[var(--color-text-secondary)]">{activeState.description}</p>
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
