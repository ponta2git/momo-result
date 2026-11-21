import type { HeldEventRecordContextResponse } from "@/shared/api/heldEvents";

/** The match conditions a new record inside a held event can carry over. */
export type RecordSetupChoice = Readonly<
  NonNullable<HeldEventRecordContextResponse["previousMatch"]>
>;

type Candidate = { readonly id: string; readonly gameTitleId?: string };

function onlyCandidate(
  candidates: readonly Candidate[] | undefined,
  gameTitleId?: string,
): string | undefined {
  const scoped =
    gameTitleId === undefined
      ? candidates
      : candidates?.filter((candidate) => candidate.gameTitleId === gameTitleId);
  return scoped?.length === 1 ? scoped[0]?.id : undefined;
}

/**
 * The choices to fill in a record's empty conditions (UI rule: 対象と導線). Every way of recording
 * from a held event applies the same rule: the held event's previous match decides 作品, and,
 * under that 作品, シーズン and マップ; otherwise a required choice with exactly one candidate is
 * chosen. A filled value is the user's or the record's own and is never replaced. シーズン and
 * マップ candidates only count once their list for the chosen 作品 is known.
 */
export function fillRecordSetup(input: {
  value: RecordSetupChoice;
  previous: RecordSetupChoice | undefined;
  gameTitles: readonly Candidate[] | undefined;
  seasons: readonly Candidate[] | undefined;
  maps: readonly Candidate[] | undefined;
}): Partial<RecordSetupChoice> {
  const { maps, previous, seasons, value } = input;
  const carriedTitle =
    previous && input.gameTitles?.some((title) => title.id === previous.gameTitleId)
      ? previous.gameTitleId
      : undefined;
  const gameTitleId = value.gameTitleId || carriedTitle || onlyCandidate(input.gameTitles) || "";
  if (!gameTitleId) return {};
  const follows = previous?.gameTitleId === gameTitleId ? previous : undefined;
  // Lists read for another 作品 say nothing about this one.
  const listed = value.gameTitleId === gameTitleId;
  const seasonMasterId =
    value.seasonMasterId ||
    follows?.seasonMasterId ||
    (listed ? onlyCandidate(seasons, gameTitleId) : undefined);
  const mapMasterId =
    value.mapMasterId ||
    follows?.mapMasterId ||
    (listed ? onlyCandidate(maps, gameTitleId) : undefined);
  return {
    ...(gameTitleId === value.gameTitleId ? {} : { gameTitleId }),
    ...(seasonMasterId && seasonMasterId !== value.seasonMasterId ? { seasonMasterId } : {}),
    ...(mapMasterId && mapMasterId !== value.mapMasterId ? { mapMasterId } : {}),
  };
}
