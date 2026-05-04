import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { listHeldEvents } from "@/features/draftReview/api";
import { deleteMatch, getMatch } from "@/features/matches/api";
import { MatchWorkspacePage } from "@/features/matches/workspace/MatchWorkspacePage";
import { fixedMembers } from "@/features/ocrCapture/localMasters";
import { listGameTitles, listMapMasters, listSeasonMasters } from "@/shared/api/masters";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";

const incidentColumns = [
  ["destination", "目的地"],
  ["plusStation", "プラス駅"],
  ["minusStation", "マイナス駅"],
  ["cardStation", "カード駅"],
  ["cardShop", "カード売り場"],
  ["suriNoGinji", "スリの銀次"],
] as const;

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

export function MatchDetailPage() {
  const { matchId = "" } = useParams<{ matchId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showConfirm, setShowConfirm] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const mode = searchParams.get("mode");

  if (mode === "edit") {
    return <MatchWorkspacePage matchId={matchId} mode="edit" />;
  }

  const matchQuery = useQuery({
    queryKey: ["match", matchId],
    queryFn: () => getMatch(matchId),
    enabled: matchId.length > 0,
  });

  const heldEventsQuery = useQuery({
    queryKey: ["held-events", "all"],
    queryFn: () => listHeldEvents("", 100),
  });
  const gameTitlesQuery = useQuery({
    queryKey: ["game-titles"],
    queryFn: () => listGameTitles(),
  });
  const seasonsQuery = useQuery({
    queryKey: ["season-masters", "all"],
    queryFn: () => listSeasonMasters(),
  });
  const mapsQuery = useQuery({
    queryKey: ["map-masters", "all"],
    queryFn: () => listMapMasters(),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteMatch(matchId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["matches"] });
      navigate("/matches", { replace: true });
    },
    onError: (error) => {
      const normalized = normalizeUnknownApiError(error);
      setErrorMessage(normalized.detail ?? normalized.title ?? "削除に失敗しました");
    },
  });

  if (matchQuery.isLoading) {
    return <p className="text-ink-200 p-8">読み込み中...</p>;
  }
  if (matchQuery.isError || !matchQuery.data) {
    return (
      <div className="p-8">
        <p className="text-red-300">試合が見つかりませんでした</p>
        <Link to="/matches" className="text-rail-gold hover:underline">
          一覧に戻る
        </Link>
      </div>
    );
  }

  const m = matchQuery.data;
  const heldEvent = (heldEventsQuery.data?.items ?? []).find((e) => e.id === m.heldEventId);
  const gameTitle = (gameTitlesQuery.data?.items ?? []).find((g) => g.id === m.gameTitleId);
  const season = (seasonsQuery.data?.items ?? []).find((s) => s.id === m.seasonMasterId);
  const map = (mapsQuery.data?.items ?? []).find((mm) => mm.id === m.mapMasterId);

  const players = (m.players ?? []).toSorted((a, b) => a.playOrder - b.playOrder);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
      <header className="flex items-center justify-between">
        <div>
          <Link to="/matches" className="text-rail-gold text-sm hover:underline">
            ← 一覧へ
          </Link>
          <h1 className="text-ink-50 text-2xl font-bold">試合詳細 #{m.matchNoInEvent}</h1>
        </div>
        <div className="flex gap-2">
          <Link to={`/exports?matchId=${encodeURIComponent(m.matchId)}`}>
            <Button variant="secondary">この試合を出力</Button>
          </Link>
          <Link to={`/matches/${encodeURIComponent(m.matchId)}/edit`}>
            <Button>編集</Button>
          </Link>
          <Button variant="danger" onClick={() => setShowConfirm(true)}>
            削除
          </Button>
        </div>
      </header>

      {errorMessage ? (
        <Card>
          <p className="text-red-300">{errorMessage}</p>
        </Card>
      ) : null}

      <Card>
        <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          <div>
            <dt className="text-ink-300">開催</dt>
            <dd>{heldEvent ? formatDate(heldEvent.heldAt) : m.heldEventId}</dd>
          </div>
          <div>
            <dt className="text-ink-300">試合番号</dt>
            <dd>#{m.matchNoInEvent}</dd>
          </div>
          <div>
            <dt className="text-ink-300">作品</dt>
            <dd>{gameTitle?.name ?? m.gameTitleId}</dd>
          </div>
          <div>
            <dt className="text-ink-300">シーズン</dt>
            <dd>{season?.name ?? m.seasonMasterId}</dd>
          </div>
          <div>
            <dt className="text-ink-300">マップ</dt>
            <dd>{map?.name ?? m.mapMasterId}</dd>
          </div>
          <div>
            <dt className="text-ink-300">親</dt>
            <dd>{memberName(m.ownerMemberId)}</dd>
          </div>
          <div>
            <dt className="text-ink-300">開催日時</dt>
            <dd>{formatDate(m.playedAt)}</dd>
          </div>
          <div>
            <dt className="text-ink-300">確定日時</dt>
            <dd>{formatDate(m.createdAt)}</dd>
          </div>
        </dl>
      </Card>

      <Card>
        <h2 className="text-ink-50 mb-3 text-lg font-bold">プレイヤー結果</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-ink-300 text-left">
              <tr>
                <th className="py-2">プレー順</th>
                <th>メンバー</th>
                <th className="text-right">順位</th>
                <th className="text-right">資産(万円)</th>
                <th className="text-right">収益(万円)</th>
                {incidentColumns.map(([key, label]) => (
                  <th key={key} className="text-right">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.memberId} className="border-line-soft border-t">
                  <td className="py-2">{p.playOrder}</td>
                  <td>{memberName(p.memberId)}</td>
                  <td className="text-right">{p.rank}</td>
                  <td className="text-right tabular-nums">
                    {p.totalAssetsManYen.toLocaleString()}
                  </td>
                  <td className="text-right tabular-nums">{p.revenueManYen.toLocaleString()}</td>
                  {incidentColumns.map(([key]) => (
                    <td key={key} className="text-right tabular-nums">
                      {p.incidents[key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {showConfirm ? (
        <DeleteConfirmModal
          matchNo={m.matchNoInEvent}
          onCancel={() => setShowConfirm(false)}
          onConfirm={() => {
            setErrorMessage(null);
            setShowConfirm(false);
            deleteMutation.mutate();
          }}
          pending={deleteMutation.isPending}
        />
      ) : null}
    </div>
  );
}

function DeleteConfirmModal({
  matchNo,
  onCancel,
  onConfirm,
  pending,
}: {
  matchNo: number;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-confirm-title"
    >
      <Card className="w-full max-w-md">
        <h2 id="delete-confirm-title" className="text-ink-50 text-lg font-bold">
          試合を削除しますか？
        </h2>
        <p className="text-ink-200 mt-2 text-sm">
          試合番号 #{matchNo} を完全に削除します。この操作は取り消せません。
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={pending}>
            キャンセル
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={pending}>
            {pending ? "削除中..." : "削除する"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
