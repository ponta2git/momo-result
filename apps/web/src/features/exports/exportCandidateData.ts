import type { HeldEventSummaryResponse, HeldEventResponse } from "@/shared/api/heldEvents";
import type { SeasonMasterResponse } from "@/shared/api/masters";
import type { MatchIdentityResponse, MatchSummaryResponse } from "@/shared/api/matches";
import { formatMatchNoInEvent } from "@/shared/domain/matchLabels";

import type { ExportCandidate } from "./exportTypes";

type ExportCandidateResolution = {
  candidate: ExportCandidate | undefined;
  state: "load-failed" | "not-found" | "resolved" | "resolving";
};

export function resolveExportCandidate(input: {
  canonicalCandidate: ExportCandidate | undefined;
  detailFailure: "load-failed" | "not-found" | null;
  detailFetching: boolean;
  selectedId: string;
  shouldResolve: boolean;
  snapshotCandidate: ExportCandidate | undefined;
}): ExportCandidateResolution {
  if (input.detailFailure === "not-found") {
    return { candidate: undefined, state: "not-found" };
  }
  if (!input.shouldResolve) {
    return { candidate: input.canonicalCandidate, state: "resolved" };
  }

  const candidate = input.canonicalCandidate ?? input.snapshotCandidate;
  if (candidate?.value === input.selectedId) {
    return { candidate, state: "resolved" };
  }
  if (input.detailFetching) {
    return { candidate: undefined, state: "resolving" };
  }
  return {
    candidate: undefined,
    state: input.detailFailure ?? "resolving",
  };
}

function matchMetadata(gameTitleName: string | undefined, seasonName: string | undefined): string {
  return `${gameTitleName ?? "作品名未取得"}・${seasonName ?? "シーズン名未取得"}`;
}

export function toSeasonCandidates(seasons: SeasonMasterResponse[]): ExportCandidate[] {
  return seasons.map((season) => ({ label: season.name, value: season.id }));
}

export function toHeldEventCandidates(events: HeldEventResponse[]): ExportCandidate[] {
  return events.map((event) => ({
    description: `${event.matchCount}試合`,
    label: formatDateTime(event.heldAt),
    value: event.id,
  }));
}

export function toMatchCandidates(matches: MatchSummaryResponse[]): ExportCandidate[] {
  return matches
    .filter((match) => match.kind === "match" && match.status === "confirmed" && match.matchId)
    .map((match) => ({
      description: matchMetadata(match.gameTitleName, match.seasonName),
      label: `${match.playedAt ? formatDateTime(match.playedAt) : "開催日時未設定"}・${formatMatchNoInEvent(match.matchNoInEvent)}`,
      value: match.matchId ?? "",
    }));
}

export function candidateFromHeldEventSummary(
  event: HeldEventSummaryResponse | undefined,
): ExportCandidate | undefined {
  return event
    ? {
        description: `${event.matchCount}試合`,
        label: formatDateTime(event.heldAt),
        value: event.id,
      }
    : undefined;
}

export function candidateFromMatchIdentity(
  match: MatchIdentityResponse | undefined,
): ExportCandidate | undefined {
  return match
    ? {
        description: matchMetadata(match.gameTitleName, match.seasonName),
        label: `${formatDateTime(match.playedAt)}・${formatMatchNoInEvent(match.matchNoInEvent)}`,
        value: match.matchId,
      }
    : undefined;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}
