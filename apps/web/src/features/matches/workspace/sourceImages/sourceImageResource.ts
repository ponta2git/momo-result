import { SourceImageDownloadError } from "@/features/matches/workspace/sourceImages/sourceImageDownloads";
import type {
  SourceImageDownload,
  SourceImageDownloads,
} from "@/features/matches/workspace/sourceImages/sourceImageDownloads";
import type {
  SourceImageItem,
  SourceImageKind,
} from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import { sourceImageKinds } from "@/features/matches/workspace/sourceImages/sourceImageTypes";

type Entry = {
  item: SourceImageItem;
  download: SourceImageDownload;
  foregroundAttempted: boolean;
  backgroundAttempted: boolean;
  replaced?: boolean;
  objectUrl?: string;
};

type ImageSnapshot = {
  descriptor: SourceImageItem | undefined;
  status: "loading" | "error" | "ready" | "replaced";
  displayUrl: string | undefined;
};
type Snapshot = Partial<Record<SourceImageKind, ImageSnapshot>>;

/** One review scope: downloads own bytes/state; this resource owns scheduling and URLs. */
export class SourceImageResource {
  private downloads: SourceImageDownloads;
  private entries = new Map<SourceImageKind, Entry>();
  private listeners = new Set<() => void>();
  private unsubscribe: (() => void) | undefined;
  private activeKind: SourceImageKind = "total_assets";
  private running: { entry: Entry; foreground: boolean } | undefined;
  private stopped = true;
  private loading = true;
  private backgroundBlocked = false;
  private snapshot: Snapshot = {};

  constructor(downloads: SourceImageDownloads) {
    this.downloads = downloads;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  connect = () => {
    this.stopped = false;
    this.backgroundBlocked = false;
    // Scope clearing must stop the scheduler before a completed read queues another image.
    this.unsubscribe = this.downloads.subscribeToClear(this.dispose);
    return this.dispose;
  };

  dispose = () => {
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.running = undefined;
    for (const entry of this.entries.values()) this.release(entry);
    this.entries.clear();
    this.publish();
  };

  update(loading: boolean, activeKind: SourceImageKind, items: SourceImageItem[] | undefined) {
    if (this.stopped) return;
    this.loading = loading;
    this.activeKind = activeKind;
    const byKind = new Map(items?.map((item) => [item.kind, item]));
    for (const kind of sourceImageKinds) {
      const item = byKind.get(kind);
      const previous = this.entries.get(kind);
      if (
        previous &&
        (!item ||
          item.imageUrl !== previous.item.imageUrl ||
          item.createdAt !== previous.item.createdAt ||
          item.contentType !== previous.item.contentType)
      ) {
        this.entries.delete(kind);
        if (this.running?.entry === previous) this.running = undefined;
        this.release(previous);
      }
      if (item?.imageUrl && !this.entries.has(kind)) {
        this.entries.set(kind, {
          item,
          download: this.downloads.acquire(item),
          foregroundAttempted: false,
          backgroundAttempted: false,
        });
      }
    }
    this.advance();
  }

  retry = () => {
    if (this.stopped) return;
    const active = this.entries.get(this.activeKind);
    if (!active || active.replaced || this.running?.entry === active) return;
    active.foregroundAttempted = false;
    this.advance();
  };

  private release(entry: Entry) {
    entry.download.release();
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
  }

  private advance() {
    if (this.stopped || this.loading) return;
    const active = this.entries.get(this.activeKind);
    if (this.running && this.running.entry === active && active) {
      this.running.foreground = true;
      active.foregroundAttempted = true;
    }
    const needsActive =
      active && !active.replaced && !active.objectUrl && !active.foregroundAttempted;
    if (this.running && needsActive) {
      const obsolete = this.running.entry;
      this.running = undefined;
      obsolete.foregroundAttempted = false;
      obsolete.download.cancel();
    }
    if (!this.running) {
      if (needsActive) {
        this.start(active, true);
      } else if (!this.backgroundBlocked) {
        const candidate = sourceImageKinds
          .map((kind) => this.entries.get(kind))
          .find((entry) => entry && !entry.objectUrl && !entry.backgroundAttempted);
        if (candidate) this.start(candidate, false);
      }
    }
    this.publish();
  }

  private start(entry: Entry, foreground: boolean) {
    entry.backgroundAttempted = true;
    if (foreground) entry.foregroundAttempted = true;
    const run = { entry, foreground };
    this.running = run;
    void entry.download
      .load()
      .then((blob) => {
        if (this.stopped || this.running !== run) return null;
        entry.objectUrl = URL.createObjectURL(blob);
        return null;
      })
      .catch((error: unknown) => {
        if (this.stopped || this.running !== run) return;
        if (!(error instanceof SourceImageDownloadError)) return;
        if (error.reason === "cancelled") {
          this.dispose();
          return;
        }
        if (error.reason === "replaced") entry.replaced = true;
        if (error.reason === "paused") this.backgroundBlocked = true;
      })
      .finally(() => {
        if (this.stopped || this.running !== run) return;
        this.running = undefined;
        this.publish();
        this.advance();
      });
  }

  private publish() {
    const next: Snapshot = {};
    for (const [kind, entry] of this.entries) {
      next[kind] = {
        descriptor: entry.item,
        status: entry.replaced
          ? "replaced"
          : entry.objectUrl
            ? "ready"
            : entry.download.hasFailed() && entry.foregroundAttempted
              ? "error"
              : "loading",
        displayUrl: entry.objectUrl,
      };
    }
    if (
      sourceImageKinds.every(
        (kind) =>
          next[kind]?.descriptor === this.snapshot[kind]?.descriptor &&
          next[kind]?.status === this.snapshot[kind]?.status &&
          next[kind]?.displayUrl === this.snapshot[kind]?.displayUrl,
      )
    )
      return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
