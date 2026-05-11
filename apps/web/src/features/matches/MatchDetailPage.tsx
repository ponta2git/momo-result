import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { fixedMembers } from "@/features/auth/members";
import { deleteMatch, getMatch } from "@/features/matches/api";
import type { MatchDetailResponse } from "@/features/matches/api";
import { invalidateMatchAndDraftCaches, matchKeys } from "@/features/matches/queryKeys";
import { listHeldEvents } from "@/shared/api/heldEvents";
import { listGameTitles, listMapMasters, listSeasonMasters } from "@/shared/api/masters";
import { formatApiError } from "@/shared/api/problemDetails";
import { heldEventKeys } from "@/shared/api/queryKeys";
import { formatManYen } from "@/shared/lib/formatters";
import { Button } from "@/shared/ui/actions/Button";
import { DataTable } from "@/shared/ui/data/DataTable";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Card } from "@/shared/ui/layout/Card";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

const incidentColumns = [
  ["destination", "目的地"],
  ["plusStation", "プラス駅"],
  ["minusStation", "マイナス駅"],
  ["cardStation", "カード駅"],
  ["cardShop", "カード売り場"],
  ["suriNoGinji", "スリの銀次"],
] as const;

type PlayerResult = NonNullable<MatchDetailResponse["players"]>[number];
type SortKey =
  | "cardShop"
  | "cardStation"
  | "destination"
  | "member"
  | "minusStation"
  | "playOrder"
  | "plusStation"
  | "rank"
  | "revenueManYen"
  | "suriNoGinji"
  | "totalAssetsManYen";
type SortState = {
  direction: "asc" | "desc";
  key: SortKey;
};

function memberName(memberId: string): string {
  return fixedMembers.find((m) => m.memberId === memberId)?.displayName ?? memberId;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function formatDateOnly(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function sortValue(player: PlayerResult, key: SortKey): number | string {
  if (key === "member") return memberName(player.memberId);
  if (key in player.incidents) return player.incidents[key as keyof PlayerResult["incidents"]];
  return player[
    key as keyof Pick<PlayerResult, "playOrder" | "rank" | "revenueManYen" | "totalAssetsManYen">
  ];
}

function nextSort(current: SortState, key: SortKey): SortState {
  if (current.key === key) {
    return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return { key, direction: "asc" };
}

export function MatchDetailPage() {
  const { matchId = "" } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showConfirm, setShowConfirm] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({ key: "playOrder", direction: "asc" });

  const matchQuery = useSuspenseQuery({
    queryFn: () => getMatch(matchId),
    queryKey: matchKeys.detail(matchId),
  });

  const heldEventsQuery = useSuspenseQuery({
    queryFn: () => listHeldEvents("", 100),
    queryKey: heldEventKeys.scope("all"),
  });
  const gameTitlesQuery = useSuspenseQuery({
    queryFn: () => listGameTitles(),
    queryKey: ["game-titles"],
  });
  const seasonsQuery = useSuspenseQuery({
    queryFn: () => listSeasonMasters(),
    queryKey: ["season-masters", "all"],
  });
  const mapsQuery = useSuspenseQuery({
    queryFn: () => listMapMasters(),
    queryKey: ["map-masters", "all"],
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteMatch(matchId),
    onError: (error) => {
      setErrorMessage(formatApiError(error, "削除に失敗しました"));
    },
    onSuccess: async () => {
      await invalidateMatchAndDraftCaches(queryClient);
      navigate("/matches", { replace: true });
    },
  });

  const match = matchQuery.data;
  const heldEvent = (heldEventsQuery.data?.items ?? []).find(
    (event) => event.id === match.heldEventId,
  );
  const gameTitle = (gameTitlesQuery.data?.items ?? []).find(
    (item) => item.id === match.gameTitleId,
  );
  const season = (seasonsQuery.data?.items ?? []).find((item) => item.id === match.seasonMasterId);
  const map = (mapsQuery.data?.items ?? []).find((item) => item.id === match.mapMasterId);
  const heldAt = heldEvent?.heldAt ?? match.playedAt;
  const players = useMemo(() => {
    return (match.players ?? []).toSorted((left, right) => {
      const leftValue = sortValue(left, sort.key);
      const rightValue = sortValue(right, sort.key);
      const direction = sort.direction === "asc" ? 1 : -1;

      if (typeof leftValue === "string" || typeof rightValue === "string") {
        return String(leftValue).localeCompare(String(rightValue), "ja-JP") * direction;
      }

      return (leftValue - rightValue) * direction;
    });
  }, [match.players, sort]);
  const rankedPlayers = useMemo(
    () => (match.players ?? []).toSorted((left, right) => left.rank - right.rank),
    [match.players],
  );

  return (
    <PageFrame className="gap-5" width="wide">
      <PageHeader
        description={`${formatDate(heldAt)} 開催 / ${gameTitle?.name ?? "作品未設定"} / ${
          map?.name ?? "マップ未設定"
        }`}
        eyebrow="試合記録"
        title={`第${match.matchNoInEvent}試合の結果`}
        actions={
          <>
            <Link to={`/exports?matchId=${encodeURIComponent(match.matchId)}`}>
              <Button variant="secondary">この試合を出力</Button>
            </Link>
            <Link to={`/matches/${encodeURIComponent(match.matchId)}/edit`}>
              <Button>編集</Button>
            </Link>
            <AlertDialog
              cancelLabel="キャンセル"
              confirmLabel={deleteMutation.isPending ? "削除中…" : "削除する"}
              description={`第${match.matchNoInEvent}試合を完全に削除します。この操作は取り消せません。`}
              open={showConfirm}
              title="試合を削除しますか？"
              trigger={
                <Button variant="danger" onClick={() => setShowConfirm(true)}>
                  削除
                </Button>
              }
              onConfirm={() => {
                setErrorMessage(null);
                setShowConfirm(false);
                deleteMutation.mutate();
              }}
              onOpenChange={setShowConfirm}
            />
          </>
        }
      />

      {errorMessage ? (
        <Notice tone="danger" title="削除に失敗しました">
          {errorMessage}
        </Notice>
      ) : null}

      <Card className="overflow-hidden p-0">
        <div className="grid gap-0 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-5 lg:border-r lg:border-b-0">
            <p className="text-xs font-semibold text-[var(--color-text-secondary)]">開催</p>
            <p className="mt-1 text-2xl font-semibold text-balance text-[var(--color-text-primary)]">
              {formatDateOnly(heldAt)}
            </p>
            <p className="mt-3 inline-flex rounded-full border border-[var(--color-action)]/45 bg-[var(--color-action)]/10 px-3 py-1 text-sm font-semibold text-[var(--color-text-primary)]">
              第{match.matchNoInEvent}試合
            </p>
          </div>
          <dl className="grid gap-4 p-5 text-sm md:grid-cols-2 xl:grid-cols-3">
            <div>
              <dt className="text-xs font-semibold text-[var(--color-text-secondary)]">作品</dt>
              <dd className="mt-1 font-semibold">{gameTitle?.name ?? "作品未設定"}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-[var(--color-text-secondary)]">シーズン</dt>
              <dd className="mt-1 font-semibold">{season?.name ?? "シーズン未設定"}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-[var(--color-text-secondary)]">マップ</dt>
              <dd className="mt-1 font-semibold">{map?.name ?? "マップ未設定"}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-[var(--color-text-secondary)]">オーナー</dt>
              <dd className="mt-1">{memberName(match.ownerMemberId)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-[var(--color-text-secondary)]">対戦日時</dt>
              <dd className="mt-1 tabular-nums">{formatDate(match.playedAt)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-[var(--color-text-secondary)]">確定日時</dt>
              <dd className="mt-1 tabular-nums">{formatDate(match.createdAt)}</dd>
            </div>
          </dl>
        </div>
      </Card>

      <Card>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] md:items-start">
          <div className="rounded-[var(--radius-md)] border border-[var(--color-action)]/45 bg-[var(--color-action)]/10 p-4">
            <p className="text-xs font-semibold text-[var(--color-text-secondary)]">優勝</p>
            <p className="mt-1 text-2xl font-semibold text-balance text-[var(--color-text-primary)]">
              {rankedPlayers[0] ? memberName(rankedPlayers[0].memberId) : "未確定"}
            </p>
            {rankedPlayers[0] ? (
              <div className="mt-3 grid gap-1 text-sm text-[var(--color-text-secondary)]">
                <p>
                  総資産{" "}
                  <span className="font-semibold text-[var(--color-text-primary)] tabular-nums">
                    {formatManYen(rankedPlayers[0].totalAssetsManYen)}
                  </span>
                </p>
                <p>
                  収益{" "}
                  <span className="font-semibold text-[var(--color-text-primary)] tabular-nums">
                    {formatManYen(rankedPlayers[0].revenueManYen)}
                  </span>
                </p>
              </div>
            ) : null}
          </div>
          <ol className="grid gap-2">
            {rankedPlayers.map((player) => (
              <li
                key={player.memberId}
                className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2"
              >
                <span className="text-lg font-semibold text-[var(--color-text-primary)] tabular-nums">
                  {player.rank}位
                </span>
                <span className="truncate font-semibold text-[var(--color-text-primary)]">
                  {memberName(player.memberId)}
                </span>
                <span className="text-sm text-[var(--color-text-secondary)] tabular-nums">
                  {formatManYen(player.totalAssetsManYen)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </Card>

      <Card>
        <div className="mb-3">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">成績詳細</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            見出しを選ぶと、各項目で並び替えできます。
          </p>
        </div>
        <DataTable
          columns={[
            {
              header: "プレー順",
              key: "playOrder",
              minWidth: "6rem",
              onSort: () => setSort((current) => nextSort(current, "playOrder")),
              renderCell: (player) => player.playOrder,
              sortDirection: sort.key === "playOrder" ? sort.direction : undefined,
              sortable: true,
            },
            {
              header: "プレーヤー",
              key: "member",
              minWidth: "10rem",
              onSort: () => setSort((current) => nextSort(current, "member")),
              renderCell: (player) => memberName(player.memberId),
              sortDirection: sort.key === "member" ? sort.direction : undefined,
              sortable: true,
            },
            {
              align: "right",
              header: "順位",
              key: "rank",
              minWidth: "5rem",
              onSort: () => setSort((current) => nextSort(current, "rank")),
              renderCell: (player) => player.rank,
              sortDirection: sort.key === "rank" ? sort.direction : undefined,
              sortable: true,
            },
            {
              align: "right",
              header: "総資産",
              key: "totalAssetsManYen",
              minWidth: "9rem",
              onSort: () => setSort((current) => nextSort(current, "totalAssetsManYen")),
              renderCell: (player) => (
                <span className="tabular-nums">{formatManYen(player.totalAssetsManYen)}</span>
              ),
              sortDirection: sort.key === "totalAssetsManYen" ? sort.direction : undefined,
              sortable: true,
            },
            {
              align: "right",
              header: "収益",
              key: "revenueManYen",
              minWidth: "9rem",
              onSort: () => setSort((current) => nextSort(current, "revenueManYen")),
              renderCell: (player) => (
                <span className="tabular-nums">{formatManYen(player.revenueManYen)}</span>
              ),
              sortDirection: sort.key === "revenueManYen" ? sort.direction : undefined,
              sortable: true,
            },
            ...incidentColumns.map(([key, label]) => ({
              align: "right" as const,
              header: label,
              key,
              minWidth: "6rem",
              onSort: () => setSort((current) => nextSort(current, key)),
              renderCell: (player: PlayerResult) => (
                <span className="tabular-nums">{player.incidents[key]}</span>
              ),
              sortDirection: sort.key === key ? sort.direction : undefined,
              sortable: true,
            })),
          ]}
          getRowKey={(player) => player.memberId}
          rows={players}
        />
      </Card>
    </PageFrame>
  );
}
