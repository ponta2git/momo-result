import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { confirmMatchSchema, toConfirmMatchRequest } from "@/features/draftReview/schema";
import type { ConfirmMatchFormValues } from "@/features/draftReview/schema";
import { getMatch, updateMatch } from "@/features/matches/api";
import type { MatchDetailResponse } from "@/features/matches/api";
import { fixedMembers } from "@/features/ocrCapture/localMasters";
import { listGameTitles, listMapMasters, listSeasonMasters } from "@/shared/api/masters";
import { listHeldEvents } from "@/features/draftReview/api";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";

const inputClass =
  "w-full rounded-2xl border border-line-soft bg-capture-black/45 px-3 py-2 text-sm text-ink-100";
const numericClass = `${inputClass} text-right tabular-nums`;
const labelClass = "text-xs font-bold tracking-[0.22em] text-ink-300 uppercase";

const incidentColumns = [
  ["destination", "目的地"],
  ["plusStation", "プラス駅"],
  ["minusStation", "マイナス駅"],
  ["cardStation", "カード駅"],
  ["cardShop", "カード売り場"],
  ["suriNoGinji", "スリの銀次"],
] as const;

type IncidentKey = (typeof incidentColumns)[number][0];

function toLocalDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function toIsoFromLocal(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

function fromMatch(detail: MatchDetailResponse): ConfirmMatchFormValues {
  const players = (detail.players ?? []).map((p) => ({
    memberId: p.memberId,
    playOrder: p.playOrder,
    rank: p.rank,
    totalAssetsManYen: p.totalAssetsManYen,
    revenueManYen: p.revenueManYen,
    incidents: {
      destination: p.incidents.destination,
      plusStation: p.incidents.plusStation,
      minusStation: p.incidents.minusStation,
      cardStation: p.incidents.cardStation,
      cardShop: p.incidents.cardShop,
      suriNoGinji: p.incidents.suriNoGinji,
    },
  }));
  while (players.length < 4) {
    const m = fixedMembers[players.length];
    players.push({
      memberId: m?.memberId ?? "member_ponta",
      playOrder: players.length + 1,
      rank: players.length + 1,
      totalAssetsManYen: 0,
      revenueManYen: 0,
      incidents: {
        destination: 0,
        plusStation: 0,
        minusStation: 0,
        cardStation: 0,
        cardShop: 0,
        suriNoGinji: 0,
      },
    });
  }
  return {
    heldEventId: detail.heldEventId,
    matchNoInEvent: detail.matchNoInEvent,
    gameTitleId: detail.gameTitleId,
    seasonMasterId: detail.seasonMasterId,
    ownerMemberId: detail.ownerMemberId as ConfirmMatchFormValues["ownerMemberId"],
    mapMasterId: detail.mapMasterId,
    playedAt: detail.playedAt,
    draftIds: {
      totalAssets: detail.totalAssetsDraftId ?? undefined,
      revenue: detail.revenueDraftId ?? undefined,
      incidentLog: detail.incidentLogDraftId ?? undefined,
    },
    players: players as ConfirmMatchFormValues["players"],
  };
}

export function MatchEditPage() {
  const { matchId = "" } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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

  const [values, setValues] = useState<ConfirmMatchFormValues | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  useEffect(() => {
    if (matchQuery.data && !values) {
      setValues(fromMatch(matchQuery.data));
    }
  }, [matchQuery.data, values]);

  const updateMutation = useMutation({
    mutationFn: (request: ConfirmMatchFormValues) =>
      updateMatch(
        matchId,
        toConfirmMatchRequest({
          ...request,
          playedAt: toIsoFromLocal(request.playedAt),
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["match", matchId] });
      await queryClient.invalidateQueries({ queryKey: ["matches"] });
      navigate(`/matches/${encodeURIComponent(matchId)}`);
    },
    onError: (error) => {
      const normalized = normalizeUnknownApiError(error);
      setErrorMessage(normalized.detail || normalized.title || "更新に失敗しました");
    },
  });

  if (matchQuery.isLoading || !values) {
    return <p className="p-8 text-ink-200">読み込み中...</p>;
  }
  if (matchQuery.isError) {
    return (
      <div className="p-8">
        <p className="text-red-300">試合が見つかりませんでした</p>
        <Link to="/matches" className="text-rail-gold hover:underline">
          一覧に戻る
        </Link>
      </div>
    );
  }

  function setField<K extends keyof ConfirmMatchFormValues>(
    key: K,
    value: ConfirmMatchFormValues[K],
  ) {
    setValues((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function setPlayer(index: number, update: Partial<ConfirmMatchFormValues["players"][number]>) {
    setValues((prev) => {
      if (!prev) return prev;
      const players = prev.players.map((p, i) => (i === index ? { ...p, ...update } : p));
      return { ...prev, players: players as ConfirmMatchFormValues["players"] };
    });
  }

  function setIncident(index: number, key: IncidentKey, value: number) {
    setValues((prev) => {
      if (!prev) return prev;
      const players = prev.players.map((p, i) =>
        i === index ? { ...p, incidents: { ...p.incidents, [key]: value } } : p,
      );
      return { ...prev, players: players as ConfirmMatchFormValues["players"] };
    });
  }

  function handleSubmit() {
    setErrorMessage(null);
    setValidationErrors([]);
    const candidate: ConfirmMatchFormValues = {
      ...values!,
      playedAt: values!.playedAt,
    };
    const result = confirmMatchSchema.safeParse(candidate);
    if (!result.success) {
      setValidationErrors(result.error.issues.map((i) => i.message));
      return;
    }
    updateMutation.mutate(result.data);
  }

  const v = values;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
      <header className="flex items-center justify-between">
        <div>
          <Link
            to={`/matches/${encodeURIComponent(matchId)}`}
            className="text-sm text-rail-gold hover:underline"
          >
            ← 詳細に戻る
          </Link>
          <h1 className="text-2xl font-bold text-ink-50">試合を編集</h1>
        </div>
      </header>

      {errorMessage ? (
        <Card>
          <p className="text-red-300">{errorMessage}</p>
        </Card>
      ) : null}
      {validationErrors.length > 0 ? (
        <Card>
          <ul className="list-disc pl-5 text-sm text-red-300">
            {validationErrors.map((msg) => (
              <li key={msg}>{msg}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={labelClass}>開催</span>
            <select
              className={inputClass}
              value={v.heldEventId}
              onChange={(e) => setField("heldEventId", e.target.value)}
            >
              {(heldEventsQuery.data?.items ?? []).map((he) => (
                <option key={he.id} value={he.id}>
                  {he.heldAt}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>試合番号</span>
            <input
              className={numericClass}
              type="number"
              min={1}
              value={v.matchNoInEvent}
              onChange={(e) => setField("matchNoInEvent", Number.parseInt(e.target.value, 10) || 0)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>作品</span>
            <select
              className={inputClass}
              value={v.gameTitleId}
              onChange={(e) => setField("gameTitleId", e.target.value)}
            >
              {(gameTitlesQuery.data?.items ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>シーズン</span>
            <select
              className={inputClass}
              value={v.seasonMasterId}
              onChange={(e) => setField("seasonMasterId", e.target.value)}
            >
              {(seasonsQuery.data?.items ?? [])
                .filter((s) => !v.gameTitleId || s.gameTitleId === v.gameTitleId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>マップ</span>
            <select
              className={inputClass}
              value={v.mapMasterId}
              onChange={(e) => setField("mapMasterId", e.target.value)}
            >
              {(mapsQuery.data?.items ?? [])
                .filter((m) => !v.gameTitleId || m.gameTitleId === v.gameTitleId)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>親</span>
            <select
              className={inputClass}
              value={v.ownerMemberId}
              onChange={(e) =>
                setField("ownerMemberId", e.target.value as ConfirmMatchFormValues["ownerMemberId"])
              }
            >
              {fixedMembers.map((m) => (
                <option key={m.memberId} value={m.memberId}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>開催日時</span>
            <input
              className={inputClass}
              type="datetime-local"
              value={toLocalDateTime(v.playedAt)}
              onChange={(e) => setField("playedAt", toIsoFromLocal(e.target.value))}
            />
          </label>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-bold text-ink-50">プレイヤー結果</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-ink-300">
              <tr>
                <th>メンバー</th>
                <th>プレー順</th>
                <th>順位</th>
                <th>資産(万円)</th>
                <th>収益(万円)</th>
                {incidentColumns.map(([key, label]) => (
                  <th key={key}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {v.players.map((p, i) => (
                <tr key={i} className="border-t border-line-soft">
                  <td>
                    <select
                      aria-label={`player-${i}-member`}
                      className={inputClass}
                      value={p.memberId}
                      onChange={(e) =>
                        setPlayer(i, {
                          memberId: e.target
                            .value as ConfirmMatchFormValues["players"][number]["memberId"],
                        })
                      }
                    >
                      {fixedMembers.map((m) => (
                        <option key={m.memberId} value={m.memberId}>
                          {m.displayName}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label={`player-${i}-playOrder`}
                      className={numericClass}
                      type="number"
                      min={1}
                      max={4}
                      value={p.playOrder}
                      onChange={(e) =>
                        setPlayer(i, { playOrder: Number.parseInt(e.target.value, 10) || 0 })
                      }
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`player-${i}-rank`}
                      className={numericClass}
                      type="number"
                      min={1}
                      max={4}
                      value={p.rank}
                      onChange={(e) =>
                        setPlayer(i, { rank: Number.parseInt(e.target.value, 10) || 0 })
                      }
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`player-${i}-totalAssets`}
                      className={numericClass}
                      type="number"
                      value={p.totalAssetsManYen}
                      onChange={(e) =>
                        setPlayer(i, {
                          totalAssetsManYen: Number.parseInt(e.target.value, 10) || 0,
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`player-${i}-revenue`}
                      className={numericClass}
                      type="number"
                      value={p.revenueManYen}
                      onChange={(e) =>
                        setPlayer(i, {
                          revenueManYen: Number.parseInt(e.target.value, 10) || 0,
                        })
                      }
                    />
                  </td>
                  {incidentColumns.map(([key]) => (
                    <td key={key}>
                      <input
                        aria-label={`player-${i}-${key}`}
                        className={numericClass}
                        type="number"
                        min={0}
                        value={p.incidents[key]}
                        onChange={(e) =>
                          setIncident(i, key, Number.parseInt(e.target.value, 10) || 0)
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex justify-end gap-2">
        <Link to={`/matches/${encodeURIComponent(matchId)}`}>
          <Button variant="secondary">キャンセル</Button>
        </Link>
        <Button onClick={handleSubmit} disabled={updateMutation.isPending}>
          {updateMutation.isPending ? "更新中..." : "保存"}
        </Button>
      </div>
    </div>
  );
}
