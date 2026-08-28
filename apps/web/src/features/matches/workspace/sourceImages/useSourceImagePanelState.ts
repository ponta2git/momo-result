import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";

import type {
  SourceImageItem,
  SourceImageKind,
} from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import { sourceImageKinds } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import { toSourceImageStates } from "@/features/matches/workspace/sourceImages/sourceImageViewModel";
import {
  downloadMatchDraftSourceImage,
  downloadMatchDraftSourceImagesArchive,
} from "@/shared/api/matchDrafts";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { triggerBrowserDownload } from "@/shared/browser/downloadFile";

const archiveDownloadError =
  "元画像を保存できませんでした。確定または削除により画像が利用できなくなった可能性があります。必要な場合は画像を再アップロードしてください。";
const archiveRateLimitError =
  "元画像の保存が短時間に集中しています。少し待ってから再度お試しください。";
const archiveTooLargeError =
  "元画像ZIPのサイズが上限を超えています。必要な画像を個別に保存してください。";

type LoadedSourceImage =
  | { status: "loading"; url: string }
  | { objectUrl: string; status: "ready"; url: string }
  | { status: "error"; url: string };

type SourceImageCache = Record<string, LoadedSourceImage>;

export function useSourceImagePanelState({
  loading,
  matchDraftId,
  preferredKind,
  sourceImages,
}: {
  loading: boolean;
  matchDraftId: string;
  preferredKind: SourceImageKind | undefined;
  sourceImages: SourceImageItem[] | undefined;
}) {
  const states = useMemo(() => toSourceImageStates(sourceImages), [sourceImages]);
  const [activeKind, setActiveKind] = useState<SourceImageKind>(preferredKind ?? "total_assets");
  const [followMode, setFollowMode] = useState<"auto" | "fixed">("auto");
  const [previewDialog, setPreviewDialog] = useState<{
    kind: SourceImageKind;
    open: boolean;
  } | null>(null);
  const [imageCache, setImageCache] = useState<SourceImageCache>({});
  const [imageRetrySequence, setImageRetrySequence] = useState(0);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [archiveSaving, setArchiveSaving] = useState(false);
  const [archiveError, setArchiveError] = useState("");
  const previewTriggerRef = useRef<HTMLElement | null>(null);
  const imageCacheRef = useRef<SourceImageCache>({});
  const imageObjectUrlsRef = useRef(new Map<string, string>());
  const imageLoadControllersRef = useRef(new Map<string, AbortController>());

  useEffect(() => {
    imageCacheRef.current = imageCache;
  }, [imageCache]);

  useEffect(() => {
    if (!preferredKind || followMode === "fixed") {
      return;
    }
    setActiveKind(preferredKind);
  }, [followMode, preferredKind]);

  const activeState = states.find((state) => state.kind === activeKind);
  const activeImageUrl = activeState?.status === "available" ? activeState.url : undefined;
  const activeImage = activeImageUrl ? imageCache[activeImageUrl] : undefined;
  const displayUrl =
    activeImage?.status === "ready" && activeImage.url === activeImageUrl
      ? activeImage.objectUrl
      : undefined;
  const previewKind = previewDialog?.kind ?? null;
  const previewUrl = previewKind === activeKind ? displayUrl : undefined;
  const availableImageCount = states.filter((state) => state.status === "available").length;
  const expectedImageCount = sourceImageKinds.length;
  const archiveSaveDisabled = loading || archiveSaving || availableImageCount === 0;

  useEffect(() => {
    const availableUrls = new Set(
      states.flatMap((state) => (state.status === "available" ? [state.url] : [])),
    );

    for (const [url, controller] of imageLoadControllersRef.current) {
      if (!availableUrls.has(url)) {
        controller.abort();
        imageLoadControllersRef.current.delete(url);
      }
    }
    for (const [url, objectUrl] of imageObjectUrlsRef.current) {
      if (!availableUrls.has(url)) {
        URL.revokeObjectURL(objectUrl);
        imageObjectUrlsRef.current.delete(url);
      }
    }

    setImageCache((current) => {
      const staleUrls = Object.keys(current).filter((url) => !availableUrls.has(url));
      if (staleUrls.length === 0) {
        return current;
      }
      const next = { ...current };
      for (const url of staleUrls) {
        delete next[url];
      }
      return next;
    });
  }, [states]);

  useEffect(() => {
    if (!activeImageUrl) {
      return;
    }

    const cached = imageCacheRef.current[activeImageUrl];
    if (cached?.status === "ready" || cached?.status === "error") {
      return;
    }
    const imageLoadControllers = imageLoadControllersRef.current;
    if (imageLoadControllers.has(activeImageUrl)) {
      return;
    }

    const controller = new AbortController();
    imageLoadControllers.set(activeImageUrl, controller);
    setImageCache((current) => {
      const latest = current[activeImageUrl];
      if (latest?.status === "ready" || latest?.status === "error") {
        return current;
      }
      return { ...current, [activeImageUrl]: { status: "loading", url: activeImageUrl } };
    });

    const loadActiveImage = async () => {
      try {
        const blob = await downloadMatchDraftSourceImage(activeImageUrl, controller.signal);
        if (controller.signal.aborted || imageLoadControllers.get(activeImageUrl) !== controller) {
          return;
        }
        const objectUrl = URL.createObjectURL(blob);
        const previousObjectUrl = imageObjectUrlsRef.current.get(activeImageUrl);
        if (previousObjectUrl) {
          URL.revokeObjectURL(previousObjectUrl);
        }
        imageObjectUrlsRef.current.set(activeImageUrl, objectUrl);
        setImageCache((current) => ({
          ...current,
          [activeImageUrl]: { objectUrl, status: "ready", url: activeImageUrl },
        }));
      } catch {
        if (controller.signal.aborted || imageLoadControllers.get(activeImageUrl) !== controller) {
          return;
        }
        setImageCache((current) => ({
          ...current,
          [activeImageUrl]: { status: "error", url: activeImageUrl },
        }));
      } finally {
        if (imageLoadControllers.get(activeImageUrl) === controller) {
          imageLoadControllers.delete(activeImageUrl);
        }
      }
    };
    void loadActiveImage();

    return () => {
      if (imageLoadControllers.get(activeImageUrl) === controller) {
        controller.abort();
        imageLoadControllers.delete(activeImageUrl);
      }
    };
  }, [activeImageUrl, imageRetrySequence]);

  useEffect(
    () => () => {
      for (const controller of imageLoadControllersRef.current.values()) {
        controller.abort();
      }
      imageLoadControllersRef.current.clear();
      for (const objectUrl of imageObjectUrlsRef.current.values()) {
        URL.revokeObjectURL(objectUrl);
      }
      imageObjectUrlsRef.current.clear();
    },
    [],
  );

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
    setActiveKind(kind);
    setFollowMode("fixed");
  }, []);

  const handleFollowModeChange = useCallback(
    (nextMode: string) => {
      const normalizedMode = nextMode === "fixed" ? "fixed" : "auto";
      setFollowMode(normalizedMode);
      if (normalizedMode === "auto" && preferredKind) {
        setActiveKind(preferredKind);
      }
    },
    [preferredKind],
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
  const handleActiveImageRetry = useCallback(() => {
    if (!activeImageUrl) {
      return;
    }
    imageLoadControllersRef.current.get(activeImageUrl)?.abort();
    imageLoadControllersRef.current.delete(activeImageUrl);
    const objectUrl = imageObjectUrlsRef.current.get(activeImageUrl);
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      imageObjectUrlsRef.current.delete(activeImageUrl);
    }
    setImageCache((current) => {
      if (!current[activeImageUrl]) {
        return current;
      }
      const next = { ...current };
      delete next[activeImageUrl];
      return next;
    });
    setImageRetrySequence((current) => current + 1);
  }, [activeImageUrl]);

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
    followMode,
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
