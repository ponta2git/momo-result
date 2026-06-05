import { useCallback, useMemo } from "react";

import {
  formatMatchDetailDate,
  formatMatchDetailDateOnly,
} from "@/features/matches/matchDetailViewModel";
import type {
  MatchDetailPlayerResult,
  MatchDetailSortKey,
} from "@/features/matches/matchDetailViewModel";
import { MatchResultIllustration } from "@/features/matches/MatchResultIllustration";
import { useMatchDetailPageController } from "@/features/matches/useMatchDetailPageController";
import { incidentColumns } from "@/shared/domain/incidents";
import { memberDisplayName } from "@/shared/domain/members";
import { formatManYen } from "@/shared/lib/formatters";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { cn } from "@/shared/ui/cn";
import { DataTable } from "@/shared/ui/data/DataTable";
import type { DataTableColumn } from "@/shared/ui/data/DataTable";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { Card } from "@/shared/ui/layout/Card";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

const matchDetailPlayerRowKey = (player: MatchDetailPlayerResult) => player.memberId;
type MatchDetailReadyController = Extract<
  ReturnType<typeof useMatchDetailPageController>,
  { status: "ready" }
>;

export function MatchDetailPage() {
  const controller = useMatchDetailPageController();

  if (controller.status === "loading") {
    return <MatchDetailLoading />;
  }

  if (controller.status === "loadFailed") {
    return <MatchDetailLoadFailed />;
  }

  return <MatchDetailReadyContent controller={controller} />;
}

function MatchDetailReadyContent({ controller }: { controller: MatchDetailReadyController }) {
  const {
    confirmDelete,
    errorMessage,
    gameTitle,
    heldAt,
    isDeletePending,
    map,
    match,
    players,
    rankedPlayers,
    season,
    setShowConfirm,
    setSortKey,
    showConfirm,
    sort,
  } = controller;
  const openDeleteDialog = useCallback(() => {
    setShowConfirm(true);
  }, [setShowConfirm]);
  const handleDeleteConfirm = useCallback(async () => {
    await confirmDelete();
  }, [confirmDelete]);
  const columns = useMemo<Array<DataTableColumn<MatchDetailPlayerResult>>>(() => {
    const sortable = (
      key: MatchDetailSortKey,
      column: Omit<DataTableColumn<MatchDetailPlayerResult>, "key" | "onSort" | "sortDirection">,
    ): DataTableColumn<MatchDetailPlayerResult> => ({
      ...column,
      key,
      onSort: () => setSortKey(key),
      sortDirection: sort.key === key ? sort.direction : undefined,
      sortable: true,
    });

    return [
      sortable("playOrder", {
        header: "プレー順",
        minWidth: "6rem",
        renderCell: (player) => player.playOrder,
      }),
      sortable("member", {
        header: "プレーヤー",
        minWidth: "10rem",
        renderCell: (player) => memberDisplayName(player.memberId),
      }),
      sortable("rank", {
        align: "right",
        header: "順位",
        minWidth: "5rem",
        renderCell: (player) => player.rank,
      }),
      sortable("totalAssetsManYen", {
        align: "right",
        header: "総資産",
        minWidth: "9rem",
        renderCell: (player) => (
          <span className="tabular-nums">{formatManYen(player.totalAssetsManYen)}</span>
        ),
      }),
      sortable("revenueManYen", {
        align: "right",
        header: "収益",
        minWidth: "9rem",
        renderCell: (player) => (
          <span className="tabular-nums">{formatManYen(player.revenueManYen)}</span>
        ),
      }),
      ...incidentColumns.map(([key, label]) =>
        sortable(key, {
          align: "right",
          header: label,
          minWidth: "6rem",
          renderCell: (player) => <span className="tabular-nums">{player.incidents[key]}</span>,
        }),
      ),
    ];
  }, [setSortKey, sort.direction, sort.key]);

  return (
    <PageFrame className="gap-5" width="wide">
      <PageHeader
        description={`${formatMatchDetailDate(heldAt)} 開催。${gameTitle?.name ?? "作品未設定"} / ${
          map?.name ?? "マップ未設定"
        }`}
        eyebrow="試合記録"
        title={`第${match.matchNoInEvent}試合の結果`}
        actions={
          <>
            <LinkButton
              to={`/exports?matchId=${encodeURIComponent(match.matchId)}`}
              variant="secondary"
            >
              この試合を出力
            </LinkButton>
            <LinkButton to={`/matches/${encodeURIComponent(match.matchId)}/edit`}>編集</LinkButton>
            <AlertDialog
              cancelLabel="キャンセル"
              confirmLabel={isDeletePending ? "削除中…" : "削除する"}
              pending={isDeletePending}
              description={`第${match.matchNoInEvent}試合を完全に削除します。この操作は取り消せません。`}
              open={showConfirm}
              title="試合を削除しますか？"
              trigger={
                <Button variant="danger" onClick={openDeleteDialog}>
                  削除
                </Button>
              }
              onConfirm={handleDeleteConfirm}
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
              {formatMatchDetailDateOnly(heldAt)}
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
              <dd className="mt-1">{memberDisplayName(match.ownerMemberId)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-[var(--color-text-secondary)]">対戦日時</dt>
              <dd className="mt-1 tabular-nums">{formatMatchDetailDate(match.playedAt)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-[var(--color-text-secondary)]">確定日時</dt>
              <dd className="mt-1 tabular-nums">{formatMatchDetailDate(match.createdAt)}</dd>
            </div>
          </dl>
        </div>
      </Card>

      <Card>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] md:items-start">
          <div className="relative overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:pr-36">
            <MatchResultIllustration className="absolute top-3 right-3 hidden max-w-28 sm:block" />
            <div className="min-w-0">
              <p className="w-fit rounded-full border border-[var(--color-warning)]/65 bg-[var(--color-warning)]/18 px-2.5 py-1 text-xs font-semibold text-[var(--color-text-primary)]">
                優勝
              </p>
              <p className="mt-3 text-2xl font-semibold text-balance text-[var(--color-text-primary)]">
                {rankedPlayers[0] ? memberDisplayName(rankedPlayers[0].memberId) : "未確定"}
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
          </div>
          <ol className="grid gap-2">
            {rankedPlayers.map((player) => (
              <li
                key={player.memberId}
                className={cn(
                  "grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 rounded-[var(--radius-sm)] border px-3 py-2",
                  player.rank === 1
                    ? "border-[var(--color-warning)]/60 bg-[var(--color-warning)]/14"
                    : "border-[var(--color-border)] bg-[var(--color-surface-subtle)]",
                )}
              >
                <span className="text-lg font-semibold text-[var(--color-text-primary)] tabular-nums">
                  {player.rank}位
                </span>
                <span className="truncate font-semibold text-[var(--color-text-primary)]">
                  {memberDisplayName(player.memberId)}
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
            見出しで並び替えできます。
          </p>
        </div>
        <DataTable columns={columns} getRowKey={matchDetailPlayerRowKey} rows={players} />
      </Card>
    </PageFrame>
  );
}

function MatchDetailLoading() {
  return (
    <PageFrame aria-busy="true" aria-label="試合詳細を読み込み中" className="gap-5" width="wide">
      <PageHeader
        description="試合結果、プレーヤー成績、開催情報を取得しています。"
        eyebrow="試合記録"
        title="試合詳細を読み込み中"
      />

      <Card className="overflow-hidden p-0">
        <div className="grid gap-0 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-5 lg:border-r lg:border-b-0">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="mt-3 h-8 w-44" />
            <Skeleton className="mt-4 h-8 w-24 rounded-full" />
          </div>
          <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
            {["game", "season", "map", "owner", "played", "created"].map((id) => (
              <div key={id} className="grid gap-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-5 w-36" />
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <Skeleton className="h-48 rounded-[var(--radius-md)]" />
          <div className="grid gap-2">
            {["rank-1", "rank-2", "rank-3", "rank-4"].map((id) => (
              <Skeleton key={id} className="h-12 rounded-[var(--radius-sm)]" />
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <div className="mb-3 grid gap-2">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="grid gap-3">
          <Skeleton className="h-10 rounded-[var(--radius-sm)]" />
          <Skeleton className="h-16 rounded-[var(--radius-sm)]" />
          <Skeleton className="h-16 rounded-[var(--radius-sm)]" />
          <Skeleton className="h-16 rounded-[var(--radius-sm)]" />
        </div>
      </Card>
    </PageFrame>
  );
}

function MatchDetailLoadFailed() {
  return (
    <PageFrame className="gap-4" width="wide">
      <Notice tone="danger" title="試合詳細を読み込めませんでした">
        一覧に戻って、対象の試合を選び直してください。
      </Notice>
      <LinkButton to="/matches" variant="secondary">
        試合一覧へ戻る
      </LinkButton>
    </PageFrame>
  );
}
