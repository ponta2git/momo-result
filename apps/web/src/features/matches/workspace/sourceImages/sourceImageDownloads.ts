import type { SourceImageItem } from "@/features/matches/workspace/sourceImages/sourceImageTypes";

type SourceImageDownloadFailure = "cancelled" | "replaced" | "paused" | "failed";

export class SourceImageDownloadError extends Error {
  readonly reason: SourceImageDownloadFailure;

  constructor(reason: SourceImageDownloadFailure, cause: unknown) {
    super("Source image download failed", { cause });
    this.reason = reason;
  }
}

export type SourceImageDownload = {
  load: () => Promise<Blob>;
  cancel: () => void;
  release: () => void;
  hasFailed: () => boolean;
};

/** Image bytes and read state stay with the downloader; clearing them ends the review scope. */
export type SourceImageDownloads = {
  acquire: (item: SourceImageItem) => SourceImageDownload;
  subscribeToClear: (onCleared: () => void) => () => void;
};
