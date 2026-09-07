import { isCancelledError } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import type {
  SourceImageItem,
  SourceImageKind,
} from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import { sourceImageKinds } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { sourceImageBlobKeys } from "@/shared/api/queryKeys";
import { sourceImageBlobQueryOptions } from "@/shared/api/sourceImageQueries";

type Entry = {
  item: SourceImageItem;
  options: ReturnType<typeof sourceImageBlobQueryOptions>;
  foregroundAttempted: boolean;
  backgroundAttempted: boolean;
  objectUrl?: string;
};

type ImageSnapshot = {
  descriptor: SourceImageItem | undefined;
  status: "loading" | "error" | "ready";
  displayUrl: string | undefined;
};
type Snapshot = Partial<Record<SourceImageKind, ImageSnapshot>>;

/** One review scope: Query owns bytes/state; this resource owns scheduling and URLs. */
export class SourceImageResource {
  private client: QueryClient;
  private draftId: string;
  private accountId: string | undefined;
  private scope: string;
  private entries = new Map<SourceImageKind, Entry>();
  private listeners = new Set<() => void>();
  private unsubscribe: (() => void) | undefined;
  private activeKind: SourceImageKind = "total_assets";
  private running: { entry: Entry; foreground: boolean } | undefined;
  private stopped = true;
  private loading = true;
  private backgroundBlocked = false;
  private snapshot: Snapshot = {};

  constructor(client: QueryClient, draftId: string, accountId: string | undefined, scope: string) {
    this.client = client;
    this.draftId = draftId;
    this.accountId = accountId;
    this.scope = scope;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  connect = () => {
    this.stopped = false;
    this.backgroundBlocked = false;
    this.unsubscribe = this.client.getQueryCache().subscribe((event) => {
      if (
        event.type === "removed" &&
        [...this.entries.values()].some((entry) => entry.options.queryKey === event.query.queryKey)
      ) {
        // Principal clearing and successful confirm/delete must also stop work
        // that would otherwise enqueue another query after the current promise.
        this.dispose();
      }
    });
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
        // Detach before our own removal, so it cannot close the whole scope.
        this.entries.delete(kind);
        if (this.running?.entry === previous) this.running = undefined;
        this.release(previous);
      }
      if (item?.imageUrl && !this.entries.has(kind)) {
        this.entries.set(kind, {
          item,
          options: sourceImageBlobQueryOptions(
            sourceImageBlobKeys.image(
              this.draftId,
              this.accountId,
              this.scope,
              kind,
              item.imageUrl,
              JSON.stringify([item.createdAt, item.contentType]),
            ),
            item.imageUrl,
          ),
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
    if (!active || this.running?.entry === active) return;
    active.foregroundAttempted = false;
    this.advance();
  };

  private release(entry: Entry) {
    this.client.removeQueries({ queryKey: entry.options.queryKey, exact: true });
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
  }

  private advance() {
    if (this.stopped || this.loading) return;
    const active = this.entries.get(this.activeKind);
    if (this.running && this.running.entry === active && active) {
      this.running.foreground = true;
      active.foregroundAttempted = true;
    }
    const needsActive = active && !active.objectUrl && !active.foregroundAttempted;
    if (this.running && needsActive) {
      const obsolete = this.running.entry;
      this.running = undefined;
      obsolete.foregroundAttempted = false;
      void this.client.cancelQueries({ queryKey: obsolete.options.queryKey, exact: true });
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
    void this.client
      .fetchQuery(entry.options)
      .then((blob) => {
        if (this.stopped || this.running !== run) return null;
        entry.objectUrl = URL.createObjectURL(blob);
        return null;
      })
      .catch((error: unknown) => {
        if (this.stopped || this.running !== run) return;
        if (isCancelledError(error)) {
          this.dispose();
          return;
        }
        const { status } = normalizeUnknownApiError(error);
        if (status === 401 || status === 403 || status === 429) this.backgroundBlocked = true;
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
      const state = this.client.getQueryState(entry.options.queryKey);
      next[kind] = {
        descriptor: entry.item,
        status: entry.objectUrl
          ? "ready"
          : state?.status === "error" && entry.foregroundAttempted
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
