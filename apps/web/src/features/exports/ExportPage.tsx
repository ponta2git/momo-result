import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { listHeldEvents } from "@/features/draftReview/api";
import { exportMatches } from "@/features/exports/api";
import type { ExportFormat, ExportScope } from "@/features/exports/api";
import { listMatches } from "@/features/matches/api";
import { listSeasonMasters } from "@/shared/api/masters";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import type { ApiDownloadResult } from "@/shared/api/client";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";

const inputClass =
  "w-full rounded-2xl border border-line-soft bg-capture-black/45 px-3 py-2 text-sm text-ink-100 transition hover:border-white/18";
const labelClass = "text-xs font-bold tracking-[0.22em] text-ink-300 uppercase";

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

function scopeFromParams(searchParams: URLSearchParams): ExportScope {
  if (searchParams.get("matchId")) return "match";
  if (searchParams.get("heldEventId")) return "heldEvent";
  if (searchParams.get("seasonMasterId")) return "season";
  return "all";
}

function triggerDownload(result: ApiDownloadResult): void {
  const url = URL.createObjectURL(result.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = result.fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function ExportPage() {
  const [searchParams] = useSearchParams();
  const [format, setFormat] = useState<ExportFormat>(
    searchParams.get("format") === "tsv" ? "tsv" : "csv",
  );
  const [scope, setScope] = useState<ExportScope>(() => scopeFromParams(searchParams));
  const [seasonMasterId, setSeasonMasterId] = useState(searchParams.get("seasonMasterId") ?? "");
  const [heldEventId, setHeldEventId] = useState(searchParams.get("heldEventId") ?? "");
  const [matchId, setMatchId] = useState(searchParams.get("matchId") ?? "");

  const seasonsQuery = useQuery({
    queryKey: ["season-masters", "all"],
    queryFn: () => listSeasonMasters(),
  });
  const heldEventsQuery = useQuery({
    queryKey: ["held-events", "all"],
    queryFn: () => listHeldEvents("", 100),
  });
  const matchesQuery = useQuery({
    queryKey: ["matches", "export"],
    queryFn: () => listMatches(),
  });

  useEffect(() => {
    if (scope === "season" && !seasonMasterId) {
      setSeasonMasterId(seasonsQuery.data?.items?.[0]?.id ?? "");
    }
    if (scope === "heldEvent" && !heldEventId) {
      setHeldEventId(heldEventsQuery.data?.items?.[0]?.id ?? "");
    }
    if (scope === "match" && !matchId) {
      setMatchId(matchesQuery.data?.items?.[0]?.matchId ?? "");
    }
  }, [
    heldEventId,
    heldEventsQuery.data,
    matchId,
    matchesQuery.data,
    scope,
    seasonMasterId,
    seasonsQuery.data,
  ]);

  const heldEventsById = useMemo(() => {
    const map = new Map<string, string>();
    for (const event of heldEventsQuery.data?.items ?? []) {
      map.set(event.id, formatDate(event.heldAt));
    }
    return map;
  }, [heldEventsQuery.data]);

  const selectedScopeReady =
    scope === "all" ||
    (scope === "season" && Boolean(seasonMasterId)) ||
    (scope === "heldEvent" && Boolean(heldEventId)) ||
    (scope === "match" && Boolean(matchId));

  const mutation = useMutation({
    mutationFn: () =>
      exportMatches({
        format,
        scope,
        seasonMasterId,
        heldEventId,
        matchId,
      }),
    onSuccess: triggerDownload,
  });

  const normalizedError = mutation.error ? normalizeUnknownApiError(mutation.error) : null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <Link to="/matches" className="text-sm text-rail-gold hover:underline">
            ← 試合一覧へ
          </Link>
          <p className="mt-4 text-xs font-bold tracking-[0.24em] text-rail-gold uppercase">
            Export Gate
          </p>
          <h1 className="mt-1 text-3xl font-black text-ink-50">CSV / TSV 出力</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-300">
            確定済み試合を、集計用の固定列順で書き出します。駅の改札で範囲を切るように、
            全体・シーズン・開催・試合の単位を選んでダウンロードします。
          </p>
        </div>
        <div className="rounded-2xl border border-line-soft bg-capture-black/35 px-4 py-3 text-sm text-ink-200">
          <span className="text-ink-400">出力対象</span>{" "}
          {scope === "all"
            ? "全試合"
            : scope === "season"
              ? "シーズン"
              : scope === "heldEvent"
                ? "開催"
                : "試合"}
        </div>
      </header>

      <Card>
        <div className="grid gap-5 md:grid-cols-[14rem_1fr]">
          <section className="rounded-3xl border border-line-soft bg-capture-black/30 p-4">
            <p className={labelClass}>File Type</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {(["csv", "tsv"] as const).map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  className={`rounded-2xl border px-3 py-3 text-sm font-black uppercase transition ${
                    format === candidate
                      ? "border-rail-gold/70 bg-rail-gold text-night-950"
                      : "border-line-soft bg-night-800/70 text-ink-200 hover:border-white/20"
                  }`}
                  onClick={() => setFormat(candidate)}
                >
                  {candidate}
                </button>
              ))}
            </div>
          </section>

          <section className="grid gap-4">
            <label className="grid gap-2">
              <span className={labelClass}>出力範囲</span>
              <select
                className={inputClass}
                value={scope}
                onChange={(event) => setScope(event.target.value as ExportScope)}
              >
                <option value="all">全試合</option>
                <option value="season">シーズン単位</option>
                <option value="heldEvent">開催単位</option>
                <option value="match">試合単位</option>
              </select>
            </label>

            {scope === "season" ? (
              <label className="grid gap-2">
                <span className={labelClass}>シーズン</span>
                <select
                  className={inputClass}
                  value={seasonMasterId}
                  onChange={(event) => setSeasonMasterId(event.target.value)}
                >
                  {(seasonsQuery.data?.items ?? []).map((season) => (
                    <option key={season.id} value={season.id}>
                      {season.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {scope === "heldEvent" ? (
              <label className="grid gap-2">
                <span className={labelClass}>開催</span>
                <select
                  className={inputClass}
                  value={heldEventId}
                  onChange={(event) => setHeldEventId(event.target.value)}
                >
                  {(heldEventsQuery.data?.items ?? []).map((event) => (
                    <option key={event.id} value={event.id}>
                      {formatDate(event.heldAt)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {scope === "match" ? (
              <label className="grid gap-2">
                <span className={labelClass}>試合</span>
                <select
                  className={inputClass}
                  value={matchId}
                  onChange={(event) => setMatchId(event.target.value)}
                >
                  {(matchesQuery.data?.items ?? []).map((match) => (
                    <option key={match.matchId} value={match.matchId}>
                      {heldEventsById.get(match.heldEventId) ?? match.heldEventId} / #
                      {match.matchNoInEvent}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </section>
        </div>

        <div className="mt-6 flex flex-col gap-3 border-t border-line-soft pt-5 md:flex-row md:items-center md:justify-between">
          <p className="text-sm text-ink-300">
            列順は要求仕様のCSV/TSV出力に固定。資産・収益は万円単位の整数で出力します。
          </p>
          <Button
            variant="primary"
            disabled={!selectedScopeReady || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "出力中..." : `${format.toUpperCase()} をダウンロード`}
          </Button>
        </div>
        {normalizedError ? (
          <p role="alert" className="mt-4 text-sm text-rail-magenta">
            {normalizedError.detail || normalizedError.title}
          </p>
        ) : null}
      </Card>
    </div>
  );
}
