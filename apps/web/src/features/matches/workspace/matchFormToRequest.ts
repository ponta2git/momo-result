import { normalizeMatchNote } from "@/features/matches/matchNoteText";
import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import { matchFormInput } from "@/features/matches/workspace/matchNumericDrafts";
import { confirmMatchFormSchema } from "@/features/matches/workspace/review/confirmMatchFormSchema";
import type { ConfirmMatchRequest, UpdateMatchRequest } from "@/shared/api/matches";
import { toIsoFromLocalDateTime } from "@/shared/lib/dateTime";
import { parseSchema } from "@/shared/lib/schemaValidation";

export type MatchConfirmRequest = ConfirmMatchRequest;
export type MatchUpdateRequest = UpdateMatchRequest;

function pruneDraftIds(values: MatchFormValues["draftIds"]): ConfirmMatchRequest["draftIds"] {
  const next: ConfirmMatchRequest["draftIds"] = {};
  if (values.totalAssets) next.totalAssets = values.totalAssets;
  if (values.revenue) next.revenue = values.revenue;
  if (values.incidentLog) next.incidentLog = values.incidentLog;
  return next;
}

export function toConfirmMatchRequest(values: MatchFormValues): MatchConfirmRequest {
  const { matchDraftId, noteBody, achievements, ...rest } = parseSchema(
    confirmMatchFormSchema,
    matchFormInput(values),
  );
  const normalizedNote = normalizeMatchNote(noteBody);
  return {
    ...rest,
    achievements: achievements.map(({ achievementName: _name, ...entry }) => entry),
    ...(matchDraftId ? { matchDraftId } : {}),
    ...(normalizedNote.trim().length > 0 ? { noteBody: normalizedNote } : {}),
    draftIds: pruneDraftIds(rest.draftIds),
    playedAt: toIsoFromLocalDateTime(rest.playedAt),
  };
}

export function toUpdateMatchRequest(values: MatchFormValues): MatchUpdateRequest {
  const {
    matchDraftId: _matchDraftId,
    noteBody: _noteBody,
    ...request
  } = toConfirmMatchRequest(values);
  if (values.expectedVersion === undefined)
    throw new Error("試合の版が不明です。試合を読み込み直してください。");
  return { ...request, expectedVersion: values.expectedVersion };
}

/** Compare only the saved result fields, so an achievement-only save never rewrites the result. */
export function matchResultFingerprint(values: MatchFormValues): string {
  const {
    achievements: _achievements,
    matchDraftId: _draft,
    noteBody: _note,
    ...result
  } = toConfirmMatchRequest(values);
  return JSON.stringify(result);
}

export function isAchievementOnlyUpdate(values: MatchFormValues): boolean {
  return Boolean(
    values.achievements?.length &&
    values.initialResultFingerprint === matchResultFingerprint(values),
  );
}
