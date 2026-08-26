import type { HeldEventDetailResponse, HeldEventResponse } from "@/shared/api/heldEvents";
import type { GameTitleResponse, SeasonMasterResponse } from "@/shared/api/masters";
import type { MatchDetailResponse, MatchSummaryResponse } from "@/shared/api/matches";
import { formatMatchNoInEvent } from "@/shared/domain/matchLabels";

import type { ExportCandidate } from "./exportTypes";
import { formatDateTime } from "./exportViewModel";

function matchMetadata(
  gameTitleId: string | undefined,
  seasonMasterId: string | undefined,
  gameTitles: GameTitleResponse[],
  seasons: SeasonMasterResponse[],
): string {
  const gameTitle = gameTitleId
    ? (gameTitles.find((item) => item.id === gameTitleId)?.name ?? "作品名未取得")
    : "作品未設定";
  const season = seasonMasterId
    ? (seasons.find((item) => item.id === seasonMasterId)?.name ?? "シーズン名未取得")
    : "シーズン未設定";
  return `${gameTitle}・${season}`;
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

export function toMatchCandidates(
  matches: MatchSummaryResponse[],
  gameTitles: GameTitleResponse[],
  seasons: SeasonMasterResponse[],
): ExportCandidate[] {
  return matches
    .filter((match) => match.kind === "match" && match.status === "confirmed" && match.matchId)
    .map((match) => ({
      description: matchMetadata(match.gameTitleId, match.seasonMasterId, gameTitles, seasons),
      label: `${match.playedAt ? formatDateTime(match.playedAt) : "開催日時未設定"} / ${formatMatchNoInEvent(match.matchNoInEvent)}`,
      value: match.matchId ?? "",
    }));
}

export function candidateFromHeldEventDetail(
  event: HeldEventDetailResponse | undefined,
): ExportCandidate | undefined {
  return event
    ? {
        description: `${event.matchCount}試合`,
        label: formatDateTime(event.heldAt),
        value: event.id,
      }
    : undefined;
}

export function candidateFromMatchDetail(
  match: MatchDetailResponse | undefined,
  gameTitles: GameTitleResponse[],
  seasons: SeasonMasterResponse[],
): ExportCandidate | undefined {
  return match
    ? {
        description: matchMetadata(match.gameTitleId, match.seasonMasterId, gameTitles, seasons),
        label: `${formatDateTime(match.playedAt)} / ${formatMatchNoInEvent(match.matchNoInEvent)}`,
        value: match.matchId,
      }
    : undefined;
}
