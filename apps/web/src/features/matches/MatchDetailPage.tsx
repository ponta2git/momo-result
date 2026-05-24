import {
  formatMatchDetailDate,
  formatMatchDetailDateOnly,
} from "@/features/matches/matchDetailViewModel";
import type { MatchDetailPlayerResult } from "@/features/matches/matchDetailViewModel";
import { MatchResultIllustration } from "@/features/matches/MatchResultIllustration";
import { useMatchDetailPageController } from "@/features/matches/useMatchDetailPageController";
import { incidentColumns } from "@/shared/domain/incidents";
import { memberDisplayName } from "@/shared/domain/members";
import { formatManYen } from "@/shared/lib/formatters";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { cn } from "@/shared/ui/cn";
import { DataTable } from "@/shared/ui/data/DataTable";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
import { MomoStationBackdrop } from "@/shared/ui/feedback/MomoStationBackdrop";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Card } from "@/shared/ui/layout/Card";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

export function MatchDetailPage() {
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
  } = useMatchDetailPageController();

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
                <Button variant="danger" onClick={() => setShowConfirm(true)}>
                  削除
                </Button>
              }
              onConfirm={async () => {
                await confirmDelete();
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

      <Card className="relative overflow-hidden p-0 sm:pr-56">
        <MomoStationBackdrop className="opacity-[0.14]" />
        <div className="relative z-[var(--z-base)] grid gap-0 lg:grid-cols-[18rem_minmax(0,1fr)]">
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
          <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-action)]/45 bg-[var(--color-action)]/10 p-4">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem] sm:items-center">
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
              <MatchResultIllustration className="mx-auto max-w-36 sm:mr-0" />
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
        <DataTable
          columns={[
            {
              header: "プレー順",
              key: "playOrder",
              minWidth: "6rem",
              onSort: () => setSortKey("playOrder"),
              renderCell: (player) => player.playOrder,
              sortDirection: sort.key === "playOrder" ? sort.direction : undefined,
              sortable: true,
            },
            {
              header: "プレーヤー",
              key: "member",
              minWidth: "10rem",
              onSort: () => setSortKey("member"),
              renderCell: (player) => memberDisplayName(player.memberId),
              sortDirection: sort.key === "member" ? sort.direction : undefined,
              sortable: true,
            },
            {
              align: "right",
              header: "順位",
              key: "rank",
              minWidth: "5rem",
              onSort: () => setSortKey("rank"),
              renderCell: (player) => player.rank,
              sortDirection: sort.key === "rank" ? sort.direction : undefined,
              sortable: true,
            },
            {
              align: "right",
              header: "総資産",
              key: "totalAssetsManYen",
              minWidth: "9rem",
              onSort: () => setSortKey("totalAssetsManYen"),
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
              onSort: () => setSortKey("revenueManYen"),
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
              onSort: () => setSortKey(key),
              renderCell: (player: MatchDetailPlayerResult) => (
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
