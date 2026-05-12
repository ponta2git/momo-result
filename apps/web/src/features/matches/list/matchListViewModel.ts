import { memberName } from "@/features/matches/list/matchListFormat";
import type {
  MatchListItemView,
  MatchListLookupMaps,
  MatchListSort,
  MatchListSourceItem,
  MatchListStatus,
  MatchListSummaryCounts,
} from "@/features/matches/list/matchListTypes";
import { parseDraftStatus } from "@/shared/domain/draftStatus";
import { compact } from "@/shared/lib/compact";

const statusPriority = {
  ocr_running: 0,
  needs_review: 1,
  draft_ready: 2,
  ocr_failed: 3,
  confirmed: 4,
} as const satisfies Record<MatchListStatus, number>;

function normalizeStatus(value: string): MatchListStatus {
  return parseDraftStatus(value) ?? "confirmed";
}

function buildPrimaryAction(item: MatchListSourceItem, status: MatchListStatus) {
  const matchId = item.matchId;
  const matchDraftId = item.matchDraftId;

  switch (status) {
    case "confirmed":
      return matchId
        ? { href: `/matches/${encodeURIComponent(matchId)}`, label: "詳細を見る" }
        : { disabled: true, label: "詳細を見る" };
    case "draft_ready":
      return matchDraftId
        ? {
            href: `/review/${encodeURIComponent(matchDraftId)}`,
            label: "内容を確認",
            variant: "primary" as const,
          }
        : { disabled: true, label: "内容を確認", variant: "primary" as const };
    case "needs_review":
      return matchDraftId
        ? {
            href: `/review/${encodeURIComponent(matchDraftId)}`,
            label: "確認事項を直す",
            variant: "primary" as const,
          }
        : { disabled: true, label: "確認事項を直す", variant: "primary" as const };
    case "ocr_failed":
      return {
        href: matchDraftId
          ? `/matches/new?matchDraftId=${encodeURIComponent(matchDraftId)}`
          : "/matches/new",
        label: "手入力で続行",
        variant: "secondary" as const,
      };
    case "ocr_running":
      return {
        disabled: true,
        label: "読み取り中",
        variant: "secondary" as const,
      };
  }
}

function buildSecondaryActions(item: MatchListSourceItem, status: MatchListStatus) {
  const matchId = item.matchId;

  if (status === "confirmed" && matchId) {
    return [
      {
        href: `/exports?matchId=${encodeURIComponent(matchId)}`,
        label: "出力",
        variant: "secondary" as const,
      },
    ];
  }

  return [];
}

function statusDescription(status: MatchListStatus): string | undefined {
  if (status === "ocr_failed") return "読み取りに失敗しました。手入力で続行できます。";
  if (status === "needs_review") return "確認が必要な項目があります。";
  return undefined;
}

export function toMatchListItemView(
  item: MatchListSourceItem,
  lookupMaps: MatchListLookupMaps,
): MatchListItemView {
  const status = normalizeStatus(item.status);
  const heldEvent = item.heldEventId ? lookupMaps.heldEventsById.get(item.heldEventId) : undefined;
  const gameTitle = item.gameTitleId ? lookupMaps.gameTitlesById.get(item.gameTitleId) : undefined;
  const season = item.seasonMasterId ? lookupMaps.seasonsById.get(item.seasonMasterId) : undefined;
  const map = item.mapMasterId ? lookupMaps.mapsById.get(item.mapMasterId) : undefined;
  const heldAt = heldEvent?.heldAt ?? item.playedAt;

  return {
    canCancelOcr: false,
    createdAt: item.createdAt,
    displayStatus:
      status === "confirmed" ? "confirmed" : status === "ocr_running" ? "ocr" : "pre_confirm",
    hasWarnings: status === "needs_review" || status === "ocr_failed",
    id: item.id,
    kind: item.kind === "match_draft" ? "match_draft" : "match",
    primaryAction: buildPrimaryAction(item, status),
    ranks: (item.ranks ?? [])
      .toSorted((left, right) => left.rank - right.rank)
      .map((rank) => ({
        displayName: memberName(rank.memberId),
        memberId: rank.memberId,
        rank: rank.rank,
      })),
    secondaryActions: buildSecondaryActions(item, status),
    status,
    statusLabel:
      status === "confirmed" ? "確定済" : status === "ocr_running" ? "処理中" : "確認待ち",
    updatedAt: item.updatedAt,
    ...compact({
      detailHref: item.matchId ? `/matches/${encodeURIComponent(item.matchId)}` : undefined,
      exportHref: item.matchId ? `/exports?matchId=${encodeURIComponent(item.matchId)}` : undefined,
      gameTitleId: item.gameTitleId || undefined,
      gameTitleName: gameTitle?.name || undefined,
      heldAt: heldAt || undefined,
      heldEventId: item.heldEventId || undefined,
      mapName: map?.name || undefined,
      matchDraftId: item.matchDraftId || undefined,
      matchId: item.matchId || undefined,
      matchNoInEvent: item.matchNoInEvent || undefined,
      ownerName: item.ownerMemberId ? memberName(item.ownerMemberId) : undefined,
      reviewHref:
        item.matchDraftId && status !== "confirmed"
          ? `/review/${encodeURIComponent(item.matchDraftId)}`
          : undefined,
      seasonMasterId: item.seasonMasterId || undefined,
      seasonName: season?.name || undefined,
      statusDescription: statusDescription(status),
    }),
  };
}

export function toMatchListItemViews(
  items: MatchListSourceItem[],
  lookupMaps: MatchListLookupMaps,
): MatchListItemView[] {
  return items.map((item) => toMatchListItemView(item, lookupMaps));
}

function dateValue(value: string | undefined): number {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

export function sortMatchListItems(
  items: MatchListItemView[],
  sort: MatchListSort,
): MatchListItemView[] {
  return items.toSorted((left, right) => {
    if (sort === "match_no_asc") {
      const diff =
        (left.matchNoInEvent ?? Number.MAX_SAFE_INTEGER) -
        (right.matchNoInEvent ?? Number.MAX_SAFE_INTEGER);
      if (diff !== 0) {
        return diff;
      }
    } else if (sort === "held_desc") {
      const diff = dateValue(right.heldAt) - dateValue(left.heldAt);
      if (diff !== 0) {
        return diff;
      }
    } else if (sort === "held_asc") {
      const diff = dateValue(left.heldAt) - dateValue(right.heldAt);
      if (diff !== 0) {
        return diff;
      }
    } else if (sort === "status_priority") {
      const diff = statusPriority[left.status] - statusPriority[right.status];
      if (diff !== 0) {
        return diff;
      }
    }

    return dateValue(right.updatedAt) - dateValue(left.updatedAt);
  });
}

export function summarizeMatchList(items: MatchListItemView[]): MatchListSummaryCounts {
  return items.reduce<MatchListSummaryCounts>(
    (summary, item) => {
      if (item.status === "ocr_running") {
        summary.ocrRunningCount += 1;
      }
      if (item.status !== "confirmed") {
        summary.incompleteCount += 1;
      }
      if (item.status !== "confirmed" && item.status !== "ocr_running") {
        summary.preConfirmCount += 1;
      }
      if (item.status === "needs_review") {
        summary.needsReviewCount += 1;
      }
      return summary;
    },
    {
      incompleteCount: 0,
      needsReviewCount: 0,
      ocrRunningCount: 0,
      preConfirmCount: 0,
    },
  );
}
