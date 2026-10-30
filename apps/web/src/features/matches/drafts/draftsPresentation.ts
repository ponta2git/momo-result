import type {
  DraftAction,
  DraftGroupKey,
  DraftGroupView,
  DraftItemView,
  DraftRemoval,
} from "@/features/matches/drafts/draftsTypes";
import type { MatchSummaryResponse } from "@/shared/api/matches";
import type { DraftStatusOrUnknown } from "@/shared/domain/draftStatus";
import { asDraftStatusOrUnknown, isCancelableDraftStatus } from "@/shared/domain/draftStatus";
import { formatMatchNoInEvent } from "@/shared/domain/matchLabels";
import { compact } from "@/shared/lib/compact";
import { formatDateTimeCompact } from "@/shared/lib/dateTime";

const groupDefinitions: Array<{ key: DraftGroupKey; note: string; title: string }> = [
  { key: "action", note: "内容を確認して確定すると、試合一覧に加わります。", title: "対応が必要" },
  { key: "failed", note: "手入力で続けるか、不要なら破棄します。", title: "読み取り失敗" },
  {
    key: "running",
    note: "読み取りが終わると「対応が必要」へ移ります。最新の状態は更新で確認できます。",
    title: "処理中",
  },
];

function groupOf(status: DraftStatusOrUnknown): DraftGroupKey | undefined {
  switch (status) {
    case "draft_ready":
    case "needs_review":
    case "unknown":
      return "action";
    case "ocr_failed":
      return "failed";
    case "ocr_running":
      return "running";
    case "confirmed":
      return undefined;
  }
}

function reviewAction(matchDraftId: string, label: string): DraftAction {
  return {
    draftStatusCheck: { draftId: matchDraftId },
    href: `/review/${encodeURIComponent(matchDraftId)}`,
    label,
    variant: "primary",
  };
}

function primaryAction(
  status: DraftStatusOrUnknown,
  matchDraftId: string,
): DraftAction | undefined {
  switch (status) {
    case "draft_ready":
      return reviewAction(matchDraftId, "内容を確認");
    case "needs_review":
      return reviewAction(matchDraftId, "確認事項を直す");
    case "unknown":
      return reviewAction(matchDraftId, "状態を確認");
    case "ocr_failed":
      return {
        draftStatusCheck: { draftId: matchDraftId },
        href: `/matches/new?matchDraftId=${encodeURIComponent(matchDraftId)}`,
        label: "手入力で続行",
        variant: "secondary",
      };
    case "ocr_running":
    case "confirmed":
      return undefined;
  }
}

function removal(status: DraftStatusOrUnknown): DraftRemoval | undefined {
  if (!isCancelableDraftStatus(status)) return undefined;
  return status === "ocr_running"
    ? { confirmLabel: "中止する", label: "読み取りを中止", title: "読み取りを中止しますか？" }
    : { confirmLabel: "破棄する", label: "破棄", title: "下書きを破棄しますか？" };
}

export function toDraftItemView(item: MatchSummaryResponse): DraftItemView | undefined {
  const status = asDraftStatusOrUnknown(item.status);
  if (!item.matchDraftId || status === "confirmed") return undefined;
  const heldAt = item.heldAt ?? item.playedAt ?? undefined;
  return {
    heldAtLabel: heldAt ? `${formatDateTimeCompact(heldAt)} の開催` : "開催未設定",
    id: item.id,
    matchDraftId: item.matchDraftId,
    status,
    title: `${formatMatchNoInEvent(item.matchNoInEvent || undefined)} · ${item.mapName || "マップ未設定"}`,
    updatedAt: item.updatedAt,
    ...compact({
      primaryAction: primaryAction(status, item.matchDraftId),
      removal: removal(status),
    }),
  };
}

/** Groups by what the reader can do next; empty groups are omitted. */
export function groupDrafts(items: MatchSummaryResponse[]): DraftGroupView[] {
  const views = items.flatMap((item) => toDraftItemView(item) ?? []);
  return groupDefinitions
    .map((group): DraftGroupView => ({
      items: views.filter((view) => groupOf(view.status) === group.key),
      key: group.key,
      note: group.note,
      title: group.title,
    }))
    .filter((group) => group.items.length > 0);
}
