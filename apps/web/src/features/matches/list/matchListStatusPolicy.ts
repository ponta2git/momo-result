import type { MatchListItemView, MatchListStatus } from "@/features/matches/list/matchListTypes";
import { asDraftStatusOrUnknown } from "@/shared/domain/draftStatus";

export const matchListStatusPriority = {
  ocr_running: 0,
  needs_review: 1,
  draft_ready: 2,
  unknown: 3,
  ocr_failed: 4,
  confirmed: 5,
} as const satisfies Record<MatchListStatus, number>;

const preConfirmDescription = "未対応の状態です。確認画面で内容を確認してください。";

const statusDescriptions = {
  confirmed: undefined,
  draft_ready: undefined,
  needs_review: "確認が必要な項目があります。",
  ocr_failed: "読み取りに失敗しました。手入力で続行できます。",
  ocr_running: undefined,
  unknown: preConfirmDescription,
} as const satisfies Record<MatchListStatus, string | undefined>;

export function normalizeMatchListStatus(value: string): MatchListStatus {
  return asDraftStatusOrUnknown(value);
}

export function matchListDisplayStatus(
  status: MatchListStatus,
): MatchListItemView["displayStatus"] {
  if (status === "confirmed") {
    return "confirmed";
  }

  return status === "ocr_running" ? "ocr" : "pre_confirm";
}

export function matchListStatusLabel(status: MatchListStatus): MatchListItemView["statusLabel"] {
  if (status === "confirmed") {
    return "確定済";
  }

  return status === "ocr_running" ? "処理中" : "確認待ち";
}

export function hasMatchListWarnings(status: MatchListStatus): boolean {
  return status === "needs_review" || status === "ocr_failed";
}

export function matchListStatusDescription(status: MatchListStatus): string | undefined {
  return statusDescriptions[status];
}
