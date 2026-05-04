import { confirmMatchSchema } from "@/features/draftReview/confirmMatchFormSchema";
import type { ConfirmMatchRequest } from "@/features/draftReview/confirmMatchFormSchema";
import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import type { components } from "@/shared/api/generated";

export type MatchConfirmRequest = ConfirmMatchRequest;
export type MatchUpdateRequest = components["schemas"]["UpdateMatchRequest"];

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
  return confirmMatchSchema.parse(values);
}

export function toUpdateMatchRequest(values: MatchFormValues): MatchUpdateRequest {
  return toConfirmMatchRequest(values);
}
