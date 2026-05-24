import { useEffect, useMemo, useRef, useState } from "react";

import { SourceImagePreviewDialog } from "@/features/matches/workspace/sourceImages/SourceImagePreviewDialog";
import { SourceImageTabs } from "@/features/matches/workspace/sourceImages/SourceImageTabs";
import {
  sourceImageKindLabels,
  sourceImageKinds,
} from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import type {
  SourceImageItem,
  SourceImageKind,
} from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import { toSourceImageStates } from "@/features/matches/workspace/sourceImages/sourceImageViewModel";
import {
  downloadMatchDraftSourceImage,
  downloadMatchDraftSourceImagesArchive,
} from "@/shared/api/matchDrafts";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { triggerBrowserDownload } from "@/shared/browser/downloadFile";
import { Button } from "@/shared/ui/actions/Button";
import { Dialog } from "@/shared/ui/feedback/Dialog";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { Card } from "@/shared/ui/layout/Card";

type SourceImagePanelProps = {
  loading: boolean;
  matchDraftId: string;
  preferredKind: SourceImageKind | undefined;
  sourceImages: SourceImageItem[] | undefined;
};

const stickyDurationMs = 15_000;

type LoadedSourceImage =
  | { status: "idle" }
  | { status: "loading"; url: string }
  | { objectUrl: string; status: "ready"; url: string }
  | { status: "error"; url: string };

const archiveDownloadError =
  "元画像を保存できませんでした。確定または削除により画像が利用できなくなった可能性があります。必要な場合は画像を再アップロードしてください。";
const archiveRateLimitError =
  "元画像の保存が短時間に集中しています。少し待ってから再度お試しください。";
const archiveTooLargeError =
  "元画像ZIPのサイズが上限を超えています。必要な画像を個別に保存してください。";

function SourceImageLoadingFrame({ detail, label }: { detail: string; label: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="grid min-h-[13rem] gap-3">
      <Skeleton className="h-[10rem] w-full rounded-[var(--radius-sm)]" />
      <p className="text-sm text-[var(--color-text-secondary)]">{detail}</p>
    </div>
  );
}

export function SourceImagePanel({
  loading,
  matchDraftId,
  preferredKind,
  sourceImages,
}: SourceImagePanelProps) {
  const states = useMemo(() => toSourceImageStates(sourceImages), [sourceImages]);
  const [activeKind, setActiveKind] = useState<SourceImageKind>(preferredKind ?? "total_assets");
  const [previewKind, setPreviewKind] = useState<SourceImageKind | null>(null);
  const [manualSwitchAt, setManualSwitchAt] = useState<number>(0);
  const [loadedImage, setLoadedImage] = useState<LoadedSourceImage>({ status: "idle" });
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [archiveSaving, setArchiveSaving] = useState(false);
  const [archiveError, setArchiveError] = useState("");
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
  const availableImageCount = states.filter((state) => state.status === "available").length;
  const expectedImageCount = sourceImageKinds.length;
  const archiveSaveDisabled = loading || archiveSaving || availableImageCount === 0;
  const archivePendingLabel = "保存中…";

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

  const saveArchive = async () => {
    setArchiveError("");
    setArchiveSaving(true);
    try {
      const result = await downloadMatchDraftSourceImagesArchive(matchDraftId);
      triggerBrowserDownload(result);
    } catch (error) {
      const normalized = normalizeUnknownApiError(error);
      if (normalized.status === 429 || normalized.code === "TOO_MANY_REQUESTS") {
        setArchiveError(archiveRateLimitError);
      } else if (normalized.category === "payload_too_large") {
        setArchiveError(archiveTooLargeError);
      } else {
        setArchiveError(archiveDownloadError);
      }
    } finally {
      setArchiveSaving(false);
    }
  };

  const handleArchiveSaveRequest = () => {
    setArchiveError("");
    if (availableImageCount < expectedImageCount) {
      setArchiveConfirmOpen(true);
      return;
    }
    void saveArchive();
  };

  const handleArchiveSaveConfirmed = () => {
    setArchiveConfirmOpen(false);
    void saveArchive();
  };

  return (
    <Card className="h-fit p-4 lg:sticky lg:top-4 lg:w-[22rem] xl:w-[26rem]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">元画像参照</h2>
          <span className="text-xs font-semibold text-[var(--color-text-secondary)]">
            {sourceImageKindLabels[activeKind]}
          </span>
        </div>
        <Button
          disabled={archiveSaveDisabled}
          pending={archiveSaving}
          pendingLabel={archivePendingLabel}
          size="sm"
          variant="secondary"
          onClick={handleArchiveSaveRequest}
        >
          元画像を保存
        </Button>
      </div>
      <p className="mt-1 text-xs text-pretty text-[var(--color-text-secondary)]">
        入力中セルに応じて参照画像を切り替えます。手動で選んだタブはしばらく固定されます。
      </p>
      {!loading && availableImageCount === 0 ? (
        <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
          保存できる元画像がありません。
        </p>
      ) : null}
      {archiveError ? (
        <p className="mt-2 text-sm text-[var(--color-danger)]">{archiveError}</p>
      ) : null}

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
          <SourceImageLoadingFrame detail="画像一覧を取得しています。" label="元画像を取得中" />
        ) : null}

        {!loading && activeState?.status === "available" && loadedImage.status === "loading" ? (
          <SourceImageLoadingFrame
            detail="元画像を読み込んでいます。"
            label={`${sourceImageKindLabels[activeState.kind]}の元画像を読み込み中`}
          />
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

      {archiveConfirmOpen ? (
        <Dialog
          open
          title="元画像がすべてそろっていません"
          onOpenChange={(open) => setArchiveConfirmOpen(open)}
        >
          <p className="text-sm leading-6 text-pretty text-[var(--color-text-secondary)]">
            {`保存できる元画像は${expectedImageCount}枚中${availableImageCount}枚です。不足している画像はZIPに含まれません。このまま保存しますか？`}
          </p>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setArchiveConfirmOpen(false)}>
              キャンセル
            </Button>
            <Button
              pending={archiveSaving}
              pendingLabel={archivePendingLabel}
              onClick={handleArchiveSaveConfirmed}
            >
              保存する
            </Button>
          </div>
        </Dialog>
      ) : null}
    </Card>
  );
}
