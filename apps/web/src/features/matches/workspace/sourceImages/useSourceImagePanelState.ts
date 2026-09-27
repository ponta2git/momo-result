import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
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
const archiveTransferError =
  "元画像ZIPを最後まで受信できませんでした。もう一度お試しください。繰り返し失敗する場合は、画像を個別に保存してください。";

type SourceImageSelection = { mode: "auto" } | { kind: SourceImageKind; mode: "fixed" };

export function useSourceImagePanelState({
  accountId,
  loading,
  matchDraftId,
  preferredKind,
  sourceImages,
  snapshotChanged,
}: {
  accountId: string | undefined;
  loading: boolean;
  matchDraftId: string;
  preferredKind: SourceImageKind | undefined;
  sourceImages: SourceImageItem[] | undefined;
  snapshotChanged: boolean;
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
  const [conflictingArchiveRevision, setConflictingArchiveRevision] = useState<string>();
  const [archiveDownloaded, setArchiveDownloaded] = useState(false);
  const archiveRequestRef = useRef<AbortController | null>(null);
  useLayoutEffect(
    () => () => {
      archiveRequestRef.current?.abort();
      archiveRequestRef.current = null;
    },
    [],
  );
  const previewTriggerRef = useRef<HTMLElement | null>(null);
  const activeKind =
    selection.mode === "fixed" ? selection.kind : (preferredKind ?? "total_assets");
  const activeState = states.find((state) => state.kind === activeKind);
  const { activeImage, displayUrl, handleActiveImageRetry, hasReplacedImage } =
    useSourceImageResource({
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
  const archiveRevision = sourceImages?.[0]?.createdAt;
  const sourceImagesChanged =
    snapshotChanged ||
    hasReplacedImage ||
    Boolean(archiveRevision && conflictingArchiveRevision === archiveRevision);
  const archiveSaveDisabled =
    loading || archiveSaving || availableImageCount === 0 || sourceImagesChanged;

  const saveArchive = useCallback(async () => {
    if (!archiveRevision || sourceImagesChanged || archiveRequestRef.current) return;
    const controller = new AbortController();
    archiveRequestRef.current = controller;
    setArchiveError("");
    setArchiveSaving(true);
    setArchiveDownloaded(false);
    try {
      const result = await downloadMatchDraftSourceImagesArchive(
        matchDraftId,
        archiveRevision,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      triggerBrowserDownload(result);
      setArchiveDownloaded(true);
    } catch (error) {
      if (controller.signal.aborted) return;
      const normalized = normalizeUnknownApiError(error);
      if (normalized.status === 409) {
        setConflictingArchiveRevision(archiveRevision);
      } else if (normalized.status === 429 || normalized.code === "TOO_MANY_REQUESTS") {
        setArchiveError(archiveRateLimitError);
      } else if (normalized.category === "payload_too_large") {
        setArchiveError(archiveTooLargeError);
      } else if (normalized.status === undefined) {
        setArchiveError(archiveTransferError);
      } else {
        setArchiveError(archiveDownloadError);
      }
    } finally {
      if (archiveRequestRef.current === controller) {
        archiveRequestRef.current = null;
        setArchiveSaving(false);
      }
    }
  }, [archiveRevision, matchDraftId, sourceImagesChanged]);

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
    archiveDownloaded,
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
    sourceImagesChanged,
  };
}
