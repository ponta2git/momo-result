import { heldEventOcrCaptureHref } from "@/features/heldEvents/heldEventNavigation";
import { canDeleteHeldEvent } from "@/features/heldEvents/list/heldEventActions";
import type {
  HeldEventCreateForm,
  HeldEventDeleteConfirmation,
} from "@/features/heldEvents/list/heldEventActions";
import type {
  HeldEventListItemResponse,
  HeldEventListPlayerResultResponse,
  HeldEventListResponse,
} from "@/shared/api/heldEvents";
import { formatMatchNoInEvent } from "@/shared/domain/matchLabels";
import { memberDisplayName, orderFixedMembers } from "@/shared/domain/members";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { heldEventDetailHref } from "@/shared/navigation/publicIdentifiers";

export type HeldEventStanding = {
  readonly averageLabel: string;
  readonly displayName: string;
  readonly memberId: string;
  readonly standing: number;
};

export type HeldEventListRowView = {
  readonly deletable: boolean;
  readonly detailHref: string;
  readonly draftCount: number;
  readonly exportHref: string;
  readonly heldAt: string;
  readonly heldAtLabel: string;
  readonly id: string;
  /** Only the overall latest event, whatever the filters, sort or page. */
  readonly latest: boolean;
  readonly matchCount: number;
  readonly noteMatch?:
    | {
        readonly matchNoLabel: string;
        readonly noteBody: string;
        readonly otherMatchCount: number;
      }
    | undefined;
  readonly ocrHref?: string | undefined;
  readonly scopes: ReadonlyArray<{ readonly key: string; readonly label: string }>;
  readonly standings: readonly HeldEventStanding[];
};

/**
 * Orders the four players by the event's average rank. Equal averages share the standing and keep
 * the canonical member order, so the ledger's identity order survives inside a tie.
 */
/** Rows compare averages across events, so every value keeps two decimals and aligns. */
function formatListAverageRank(averageRank: number): string {
  return averageRank.toLocaleString("ja-JP", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

export function heldEventStandings(
  results: ReadonlyArray<Readonly<HeldEventListPlayerResultResponse>>,
): HeldEventStanding[] {
  const ordered = orderFixedMembers(results).toSorted(
    (left, right) => left.averageRank - right.averageRank,
  );
  return ordered.map((result) => ({
    averageLabel: formatListAverageRank(result.averageRank),
    displayName: memberDisplayName(result.memberId),
    memberId: result.memberId,
    standing: 1 + ordered.filter((other) => other.averageRank < result.averageRank).length,
  }));
}

function scopeLabel(scope: NonNullable<HeldEventListItemResponse["scopes"]>[number]): string {
  const title = scope.gameTitleName ?? (scope.gameTitleId ? "作品名未取得" : "作品未設定");
  const season = scope.seasonName ?? (scope.seasonMasterId ? "シーズン名未取得" : "シーズン未設定");
  return `${title}・${season}`;
}

export function toHeldEventListRows(
  items: ReadonlyArray<Readonly<HeldEventListItemResponse>>,
  latestHeldEventId: string | undefined,
): HeldEventListRowView[] {
  return items.map((item) => {
    const latest = latestHeldEventId !== undefined && item.id === latestHeldEventId;
    const noteMatch = item.noteMatch;
    return {
      deletable: canDeleteHeldEvent(item),
      detailHref: heldEventDetailHref(item.id, item.publicId),
      draftCount: item.draftCount,
      exportHref: `/exports?heldEventId=${encodeURIComponent(item.id)}&format=csv`,
      heldAt: item.heldAt,
      heldAtLabel: formatDateTimeLong(item.heldAt),
      id: item.id,
      latest,
      matchCount: item.matchCount,
      noteMatch: noteMatch
        ? {
            matchNoLabel: formatMatchNoInEvent(noteMatch.matchNoInEvent),
            noteBody: noteMatch.noteBody,
            otherMatchCount: noteMatch.otherMatchCount,
          }
        : undefined,
      ocrHref: latest ? heldEventOcrCaptureHref(item.id) : undefined,
      scopes: (item.scopes ?? []).map((scope) => ({
        key: `${scope.gameTitleId ?? ""}:${scope.seasonMasterId ?? ""}`,
        label: scopeLabel(scope),
      })),
      standings: heldEventStandings(item.playerResults ?? []),
    };
  });
}

/** Only a confirmed page of the requested search may correct an out-of-range page. */
export function heldEventsPageCorrection(
  requestedPage: number,
  pagination: HeldEventListResponse["pagination"] | undefined,
  confirmed: boolean,
): number | undefined {
  if (!pagination || !confirmed) return undefined;
  const lastPage = Math.max(pagination.totalPages, 1);
  return requestedPage > lastPage ? lastPage : undefined;
}

/** Relates the requested search to the retained read before exposing rows or actions. */
export function resolveHeldEventListDisplayState({
  locationSettling,
  list,
}: {
  locationSettling: boolean;
  list: { available: boolean; fromPreviousSelection: boolean; refreshing: boolean };
}) {
  const scopeChanging = locationSettling || list.fromPreviousSelection;
  return {
    scopeChanging,
    sameScopeRefreshing: !scopeChanging && list.refreshing,
    updating:
      locationSettling || ((list.fromPreviousSelection || list.available) && list.refreshing),
  };
}

export function buildHeldEventsActionView({
  create,
  deleteDialog,
  errorMessage,
}: {
  create: HeldEventCreateForm;
  deleteDialog: HeldEventDeleteConfirmation;
  errorMessage: string;
}) {
  return {
    dialogPending: create.pending || deleteDialog.pending,
    errorMessage: !create.open && !deleteDialog.target ? errorMessage : "",
  } as const;
}
