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

const stickyDurationMs = 15_000;
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
  const [previewKind, setPreviewKind] = useState<SourceImageKind | null>(null);
  const [manualSwitchAt, setManualSwitchAt] = useState<number>(0);
  const [imageCache, setImageCache] = useState<SourceImageCache>({});
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
    if (!preferredKind) {
      return;
    }
    if (Date.now() - manualSwitchAt <= stickyDurationMs) {
      return;
    }
    setActiveKind(preferredKind);
  }, [manualSwitchAt, preferredKind]);

  const activeState = states.find((state) => state.kind === activeKind);
  const activeImageUrl = activeState?.status === "available" ? activeState.url : undefined;
  const activeImage = activeImageUrl ? imageCache[activeImageUrl] : undefined;
  const displayUrl =
    activeImage?.status === "ready" && activeImage.url === activeImageUrl
      ? activeImage.objectUrl
      : undefined;
  const previewUrl = previewKind === activeKind ? displayUrl : undefined;
  const availableImageCount = states.filter((state) => state.status === "available").length;
  const expectedImageCount = sourceImageKinds.length;
  const archiveSaveDisabled = loading || archiveSaving || availableImageCount === 0;

  useEffect(() => {
    const availableUrls = new Set(
      states.flatMap((state) => (state.status === "available" ? [state.url] : [])),
    );

    setImageCache((current) => {
      let next = current;
      for (const url of Object.keys(current)) {
        if (!availableUrls.has(url)) {
          imageLoadControllersRef.current.get(url)?.abort();
          imageLoadControllersRef.current.delete(url);
          const objectUrl = imageObjectUrlsRef.current.get(url);
          if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
            imageObjectUrlsRef.current.delete(url);
          }
          if (next === current) {
            next = { ...current };
          }
          delete next[url];
        }
      }
      return next;
    });

    for (const url of availableUrls) {
      const cached = imageCacheRef.current[url];
      if (cached?.status === "loading" || cached?.status === "ready") {
        continue;
      }
      const controller = new AbortController();
      imageLoadControllersRef.current.set(url, controller);
      setImageCache((current) => {
        const latest = current[url];
        if (latest?.status === "loading" || latest?.status === "ready") {
          return current;
        }
        return { ...current, [url]: { status: "loading", url } };
      });

      const preloadImage = async () => {
        try {
          const blob = await downloadMatchDraftSourceImage(url, controller.signal);
          if (controller.signal.aborted) {
            return;
          }
          const objectUrl = URL.createObjectURL(blob);
          imageObjectUrlsRef.current.set(url, objectUrl);
          setImageCache((current) => ({ ...current, [url]: { objectUrl, status: "ready", url } }));
        } catch {
          if (controller.signal.aborted) {
            return;
          }
          setImageCache((current) => ({ ...current, [url]: { status: "error", url } }));
        } finally {
          if (imageLoadControllersRef.current.get(url) === controller) {
            imageLoadControllersRef.current.delete(url);
          }
        }
      };
      void preloadImage();
    }
  }, [states]);

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
    setManualSwitchAt(Date.now());
  }, []);

  const handlePreviewOpen = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (activeState?.status !== "available") {
        return;
      }
      previewTriggerRef.current = event.currentTarget;
      setPreviewKind(activeState.kind);
    },
    [activeState],
  );

  const handlePreviewClose = useCallback(() => {
    setPreviewKind(null);
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
    handleArchiveCancel: () => setArchiveConfirmOpen(false),
    handleArchiveDialogOpenChange: setArchiveConfirmOpen,
    handleArchiveSaveConfirmed,
    handleArchiveSaveRequest,
    handlePreviewClose,
    handlePreviewOpen,
    handleSourceImageTabChange,
    previewKind,
    previewUrl,
  };
}
