import type { MatchDraftDetailResponse } from "@/shared/api/matchDrafts";
import { isConfirmed } from "@/shared/domain/draftStatus";

export const confirmedDraftMessages = {
  confirmConflict: "この下書きはすでに確定済みです。試合詳細に移動しました。",
  listRedirect: "確定済みだったため試合詳細に移動しました。",
  loadRedirect: "この下書きはすでに確定済みです。試合詳細に移動しました。",
  statusCheckFailed:
    "下書きの最新状態を確認できませんでした。少し待ってからもう一度お試しください。",
} as const;

export type ConfirmedDraftDestination = {
  matchId: string;
  path: string;
};

export function confirmedDraftDestination(
  detail: MatchDraftDetailResponse | undefined,
): ConfirmedDraftDestination | undefined {
  if (!isConfirmed(detail?.status) || !detail?.confirmedMatchId) {
    return undefined;
  }

  return {
    matchId: detail.confirmedMatchId,
    path: `/matches/${encodeURIComponent(detail.confirmedMatchId)}`,
  };
}
