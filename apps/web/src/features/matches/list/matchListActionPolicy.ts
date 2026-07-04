import type {
  MatchListAction,
  MatchListSourceItem,
  MatchListStatus,
} from "@/features/matches/list/matchListTypes";

function matchDetailHref(matchId: string): string {
  return `/matches/${encodeURIComponent(matchId)}`;
}

function reviewHref(matchDraftId: string): string {
  return `/review/${encodeURIComponent(matchDraftId)}`;
}

function manualEntryHref(matchDraftId?: string): string {
  return matchDraftId
    ? `/matches/new?matchDraftId=${encodeURIComponent(matchDraftId)}`
    : "/matches/new";
}

function exportHref(matchId: string): string {
  return `/exports?matchId=${encodeURIComponent(matchId)}`;
}

function draftStatusCheck(matchDraftId: string): Pick<MatchListAction, "draftStatusCheck"> {
  return { draftStatusCheck: { draftId: matchDraftId } };
}

function draftAction(
  matchDraftId: string | undefined,
  label: string,
  variant: MatchListAction["variant"] = "primary",
): MatchListAction {
  if (!matchDraftId) {
    return { disabled: true, label, variant };
  }

  return {
    ...draftStatusCheck(matchDraftId),
    href: reviewHref(matchDraftId),
    label,
    variant,
  };
}

export function buildMatchListPrimaryAction(
  item: MatchListSourceItem,
  status: MatchListStatus,
): MatchListAction {
  const { matchDraftId, matchId } = item;

  switch (status) {
    case "confirmed":
      return matchId
        ? { href: matchDetailHref(matchId), label: "詳細を見る" }
        : { disabled: true, label: "詳細を見る" };
    case "draft_ready":
      return draftAction(matchDraftId, "内容を確認");
    case "needs_review":
      return draftAction(matchDraftId, "確認事項を直す");
    case "ocr_failed":
      return {
        ...(matchDraftId ? draftStatusCheck(matchDraftId) : {}),
        href: manualEntryHref(matchDraftId),
        label: "手入力で続行",
        variant: "secondary",
      };
    case "ocr_running":
      return { disabled: true, label: "読み取り中", variant: "secondary" };
    case "unknown":
      return draftAction(matchDraftId, "状態を確認");
  }
}

export function buildMatchListSecondaryActions(
  item: MatchListSourceItem,
  status: MatchListStatus,
): MatchListAction[] {
  if (status !== "confirmed" || !item.matchId) {
    return [];
  }

  return [{ href: exportHref(item.matchId), label: "出力", variant: "secondary" }];
}

export function matchListDetailHref(matchId: string | undefined): string | undefined {
  return matchId ? matchDetailHref(matchId) : undefined;
}

export function matchListExportHref(matchId: string | undefined): string | undefined {
  return matchId ? exportHref(matchId) : undefined;
}

export function matchListReviewHref(
  matchDraftId: string | undefined,
  status: MatchListStatus,
): string | undefined {
  return matchDraftId && status !== "confirmed" ? reviewHref(matchDraftId) : undefined;
}
