import { useCallback, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";

import type {
  SourceImageItem,
  SourceImageKind,
} from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import { sourceImageKinds } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import { toSourceImageStates } from "@/features/matches/workspace/sourceImages/sourceImageViewModel";
import { useSourceImageResource } from "@/features/matches/workspace/sourceImages/useSourceImageResource";
import { downloadMatchDraftSourceImagesArchive } from "@/shared/api/matchDrafts";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { triggerBrowserDownload } from "@/shared/browser/downloadFile";

const archiveDownloadError =
  "元画像を保存できませんでした。確定または削除により画像が利用できなくなった可能性があります。必要な場合は画像を再アップロードしてください。";
const archiveRateLimitError =
  "元画像の保存が短時間に集中しています。少し待ってから再度お試しください。";
const archiveTooLargeError =
  "元画像ZIPのサイズが上限を超えています。必要な画像を個別に保存してください。";

type SourceImageSelection = { mode: "auto" } | { kind: SourceImageKind; mode: "fixed" };

export function useSourceImagePanelState({
  accountId,
  loading,
  matchDraftId,
  preferredKind,
  sourceImages,
}: {
  accountId: string | undefined;
  loading: boolean;
  matchDraftId: string;
  preferredKind: SourceImageKind | undefined;
  sourceImages: SourceImageItem[] | undefined;
}) {
  const states = useMemo(() => toSourceImageStates(sourceImages), [sourceImages]);
  const [selection, setSelection] = useState<SourceImageSelection>({ mode: "auto" });
  const [previewDialog, setPreviewDialog] = useState<{
    kind: SourceImageKind;
    open: boolean;
  } | null>(null);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [archiveSaving, setArchiveSaving] = useState(false);
  const [archiveError, setArchiveError] = useState("");
  const previewTriggerRef = useRef<HTMLElement | null>(null);
  const activeKind =
    selection.mode === "fixed" ? selection.kind : (preferredKind ?? "total_assets");
  const activeState = states.find((state) => state.kind === activeKind);
  const { activeImage, displayUrl, handleActiveImageRetry } = useSourceImageResource({
    accountId,
    matchDraftId,
    loading,
    activeKind,
    sourceImages,
  });
  const previewKind = previewDialog?.kind ?? null;
  const previewUrl = previewKind === activeKind ? displayUrl : undefined;
  const availableImageCount = states.filter((state) => state.status === "available").length;
  const expectedImageCount = sourceImageKinds.length;
  const archiveSaveDisabled = loading || archiveSaving || availableImageCount === 0;

  const saveArchive = useCallback(async () => {
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
  }, [matchDraftId]);

  const handleArchiveSaveRequest = useCallback(() => {
    setArchiveError("");
    if (availableImageCount < expectedImageCount) {
      setArchiveConfirmOpen(true);
      return;
    }
    void saveArchive();
  }, [availableImageCount, expectedImageCount, saveArchive]);

  const handleArchiveSaveConfirmed = useCallback(() => {
    setArchiveConfirmOpen(false);
    void saveArchive();
  }, [saveArchive]);

  const handleSourceImageTabChange = useCallback((kind: SourceImageKind) => {
    setSelection({ kind, mode: "fixed" });
  }, []);

  const handleFollowModeChange = useCallback(
    (nextMode: string) => {
      setSelection(nextMode === "fixed" ? { kind: activeKind, mode: "fixed" } : { mode: "auto" });
    },
    [activeKind],
  );

  const handlePreviewOpen = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (activeState?.status !== "available") {
        return;
      }
      previewTriggerRef.current = event.currentTarget;
      setPreviewDialog({ kind: activeState.kind, open: true });
    },
    [activeState],
  );

  const handlePreviewClose = useCallback(() => {
    setPreviewDialog((current) => (current ? { ...current, open: false } : null));
    previewTriggerRef.current?.focus();
  }, []);
  return {
    activeImage,
    activeKind,
    activeState,
    archiveConfirmOpen,
    archiveError,
    archiveSaveDisabled,
    archiveSaving,
    availableImageCount,
    displayUrl,
    expectedImageCount,
    followMode: selection.mode,
    handleArchiveCancel: () => setArchiveConfirmOpen(false),
    handleArchiveDialogOpenChange: setArchiveConfirmOpen,
    handleArchiveSaveConfirmed,
    handleArchiveSaveRequest,
    handleActiveImageRetry,
    handleFollowModeChange,
    handlePreviewClose,
    handlePreviewOpen,
    handleSourceImageTabChange,
    previewKind,
    previewOpen: previewDialog?.open ?? false,
    previewUrl,
  };
}
