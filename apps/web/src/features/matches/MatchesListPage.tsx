import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSearchParams } from "react-router-dom";
import { fixedMembers } from "@/features/ocrCapture/localMasters";
import { listMatches } from "@/features/matches/api";
import type { ListMatchesQuery, MatchSummaryResponse } from "@/features/matches/api";
import { listGameTitles, listSeasonMasters } from "@/shared/api/masters";
import type { GameTitleResponse, SeasonMasterResponse } from "@/shared/api/masters";
import { listHeldEvents } from "@/features/draftReview/api";
import type { HeldEventResponse } from "@/features/draftReview/api";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";

const inputClass =
  "w-full rounded-2xl border border-line-soft bg-capture-black/45 px-3 py-2 text-sm text-ink-100";
const labelClass = "text-xs font-bold tracking-[0.22em] text-ink-300 uppercase";

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

export function MatchesListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const heldEventId = searchParams.get("heldEventId") ?? "";
  const gameTitleId = searchParams.get("gameTitleId") ?? "";
  const seasonMasterId = searchParams.get("seasonMasterId") ?? "";

  const [draftHeldEvent, setDraftHeldEvent] = useState(heldEventId);
  const [draftGameTitle, setDraftGameTitle] = useState(gameTitleId);
  const [draftSeason, setDraftSeason] = useState(seasonMasterId);

  useEffect(() => setDraftHeldEvent(heldEventId), [heldEventId]);
  useEffect(() => setDraftGameTitle(gameTitleId), [gameTitleId]);
  useEffect(() => setDraftSeason(seasonMasterId), [seasonMasterId]);

  const heldEventsQuery = useQuery({
    queryKey: ["held-events", "all"],
    queryFn: () => listHeldEvents("", 100),
  });
  const gameTitlesQuery = useQuery({
    queryKey: ["game-titles"],
    queryFn: () => listGameTitles(),
  });
  const seasonsQuery = useQuery({
    queryKey: ["season-masters", draftGameTitle || "all"],
    queryFn: () => listSeasonMasters(draftGameTitle || undefined),
  });

  const matchesQuery = useQuery({
    queryKey: ["matches", { heldEventId, gameTitleId, seasonMasterId }],
    queryFn: () => {
      const q: ListMatchesQuery = {};
      if (heldEventId) q.heldEventId = heldEventId;
      if (gameTitleId) q.gameTitleId = gameTitleId;
      if (seasonMasterId) q.seasonMasterId = seasonMasterId;
      return listMatches(q);
    },
  });

  const heldEventsById = useMemo(() => {
    const map = new Map<string, HeldEventResponse>();
    for (const e of heldEventsQuery.data?.items ?? []) map.set(e.id, e);
    return map;
  }, [heldEventsQuery.data]);
  const gameTitlesById = useMemo(() => {
    const map = new Map<string, GameTitleResponse>();
    for (const g of gameTitlesQuery.data?.items ?? []) map.set(g.id, g);
    return map;
  }, [gameTitlesQuery.data]);
  const seasonsById = useMemo(() => {
    const map = new Map<string, SeasonMasterResponse>();
    for (const s of seasonsQuery.data?.items ?? []) map.set(s.id, s);
    return map;
  }, [seasonsQuery.data]);

  function applyFilter() {
    const next = new URLSearchParams();
    if (draftHeldEvent) next.set("heldEventId", draftHeldEvent);
    if (draftGameTitle) next.set("gameTitleId", draftGameTitle);
    if (draftSeason) next.set("seasonMasterId", draftSeason);
    setSearchParams(next);
  }

  function clearFilter() {
    setDraftHeldEvent("");
    setDraftGameTitle("");
    setDraftSeason("");
    setSearchParams(new URLSearchParams());
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink-50">確定済み試合一覧</h1>
      </header>
      <Card>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className={labelClass}>開催</span>
            <select
              className={inputClass}
              value={draftHeldEvent}
              onChange={(e) => setDraftHeldEvent(e.target.value)}
            >
              <option value="">すべて</option>
              {(heldEventsQuery.data?.items ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {formatDate(e.heldAt)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>作品</span>
            <select
              className={inputClass}
              value={draftGameTitle}
              onChange={(e) => {
                setDraftGameTitle(e.target.value);
                setDraftSeason("");
              }}
            >
              <option value="">すべて</option>
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
              value={draftSeason}
              onChange={(e) => setDraftSeason(e.target.value)}
            >
              <option value="">すべて</option>
              {(seasonsQuery.data?.items ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-4 flex gap-2">
          <Button onClick={applyFilter}>絞り込み</Button>
          <Button variant="secondary" onClick={clearFilter}>
            クリア
          </Button>
        </div>
      </Card>

      <Card>
        {matchesQuery.isLoading ? (
          <p className="text-ink-200">読み込み中...</p>
        ) : matchesQuery.isError ? (
          <p className="text-red-300">読み込みに失敗しました</p>
        ) : (matchesQuery.data?.items ?? []).length === 0 ? (
          <p className="text-ink-300">該当する試合がありません</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-ink-300">
              <tr>
                <th className="py-2">開催 / #</th>
                <th>作品</th>
                <th>シーズン</th>
                <th>順位 (1→4)</th>
                <th>確定</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(matchesQuery.data?.items ?? []).map((m) => (
                <MatchRow
                  key={m.matchId}
                  match={m}
                  heldEvent={heldEventsById.get(m.heldEventId)}
                  gameTitleName={gameTitlesById.get(m.gameTitleId)?.name}
                  seasonName={seasonsById.get(m.seasonMasterId)?.name}
                />
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function MatchRow({
  match,
  heldEvent,
  gameTitleName,
  seasonName,
}: {
  match: MatchSummaryResponse;
  heldEvent: HeldEventResponse | undefined;
  gameTitleName: string | undefined;
  seasonName: string | undefined;
}) {
  const ranked = [...(match.ranks ?? [])].sort((a, b) => a.rank - b.rank);
  return (
    <tr className="border-t border-line-soft">
      <td className="py-2">
        <div>{heldEvent ? formatDate(heldEvent.heldAt) : match.heldEventId}</div>
        <div className="text-xs text-ink-300">#{match.matchNoInEvent}</div>
      </td>
      <td>{gameTitleName ?? match.gameTitleId}</td>
      <td>{seasonName ?? match.seasonMasterId}</td>
      <td className="text-xs">
        {ranked
          .map((r, idx) => `${idx + 1}: ${memberName(r.memberId)}`)
          .join(" / ")}
      </td>
      <td className="text-xs text-ink-300">{formatDate(match.createdAt)}</td>
      <td>
        <Link
          to={`/matches/${encodeURIComponent(match.matchId)}`}
          className="text-rail-gold hover:underline"
        >
          詳細
        </Link>
      </td>
    </tr>
  );
}
