import type { MatchListItemView, MatchListStatus } from "@/features/matches/list/matchListTypes";
import { asDraftStatusOrUnknown } from "@/shared/domain/draftStatus";

const preConfirmDescription = "状態を確認して、確定までの対応を続けてください。";

const statusDescriptions = {
  confirmed: undefined,
  draft_ready: "内容を確認すると、確定へ進めます。",
  needs_review: "確認が必要な項目があります。",
  ocr_failed: "読み取りに失敗しました。手入力で続行できます。",
  ocr_running: "読み取り完了後に内容を確認できます。",
  unknown: preConfirmDescription,
} as const satisfies Record<MatchListStatus, string | undefined>;

const statusLabels = {
  confirmed: "確定済",
  draft_ready: "確認待ち",
  needs_review: "要確認",
  ocr_failed: "読取失敗",
  ocr_running: "処理中",
  unknown: "状態不明",
} as const satisfies Record<MatchListStatus, MatchListItemView["statusLabel"]>;

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
  return statusLabels[status];
}

export function hasMatchListWarnings(status: MatchListStatus): boolean {
  return status === "needs_review" || status === "ocr_failed";
}

export function matchListStatusDescription(status: MatchListStatus): string | undefined {
  return statusDescriptions[status];
}
