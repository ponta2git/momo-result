import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import { matchFormInput } from "@/features/matches/workspace/matchNumericDrafts";
import { confirmMatchSchema } from "@/features/matches/workspace/review/confirmMatchFormSchema";
import type { ConfirmMatchRequest, UpdateMatchRequest } from "@/shared/api/matches";

export type MatchConfirmRequest = ConfirmMatchRequest;
export type MatchUpdateRequest = UpdateMatchRequest;

/**
 * フォーム値を `ConfirmMatchRequest` (= 確定 API リクエスト DTO) に変換する。
 *
 * 値変換 (ISO 化・draftIds の null 落とし) は `confirmMatchSchema.transform` が
 * 行うため、ここは parse 呼び出しの薄いラッパに過ぎない。
 *
 * 呼び出し側は事前に validateMatchForm で検証済みである前提で、ここでは throw する
 * `parse` を使う (検証エラーは UI 側で先に握っている)。
 */
export function toConfirmMatchRequest(values: MatchFormValues): MatchConfirmRequest {
  return confirmMatchSchema.parse(matchFormInput(values));
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
