import type { DraftStatusOrUnknown } from "@/shared/domain/draftStatus";

/** A navigation to continue a draft; `draftStatusCheck` first confirms it was not confirmed meanwhile. */
export type DraftAction = {
  disabled?: boolean;
  draftStatusCheck?: {
    draftId: string;
  };
  href?: string;
  label: string;
  variant?: "primary" | "quiet" | "secondary";
};

export type DraftRemoval = {
  confirmLabel: string;
  label: string;
  title: string;
};

export type DraftGroupKey = "action" | "failed" | "running";

export type DraftItemView = {
  heldAtLabel: string;
  id: string;
  matchDraftId: string;
  primaryAction?: DraftAction;
  removal?: DraftRemoval;
  status: DraftStatusOrUnknown;
  title: string;
  updatedAt: string;
};

export type DraftGroupView = {
  items: DraftItemView[];
  key: DraftGroupKey;
  note: string;
  title: string;
};
