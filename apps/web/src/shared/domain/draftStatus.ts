/**
 * 試合下書き / 試合のドメイン状態（API は string で返すが、UI 側で
 * 判別共用体として扱うことで分岐漏れを防ぐ）。
 *
 * - `parseDraftStatus()` で API の生 string を narrow
 * - `isXxx()` ガードで UI 分岐を表現
 *
 * 「未知の状態」は `unknown` として扱い、UI が未知値を安全に表示できるようにする。
 */

export const draftStatuses = [
  "confirmed",
  "draft_ready",
  "needs_review",
  "ocr_failed",
  "ocr_running",
] as const;

export type DraftStatus = (typeof draftStatuses)[number];

export type DraftStatusOrUnknown = DraftStatus | "unknown";

export const draftStatusLabels = {
  confirmed: "確定済み",
  draft_ready: "確認待ち",
  needs_review: "要確認",
  ocr_failed: "読み取り失敗",
  ocr_running: "処理中",
  unknown: "状態不明",
} as const satisfies Record<DraftStatusOrUnknown, string>;

export type DraftStatusLabel = (typeof draftStatusLabels)[DraftStatusOrUnknown];

export function isDraftStatus(value: string | null | undefined): value is DraftStatus {
  return typeof value === "string" && (draftStatuses as readonly string[]).includes(value);
}

export function parseDraftStatus(value: string | null | undefined): DraftStatus | undefined {
  return isDraftStatus(value) ? value : undefined;
}

export function asDraftStatusOrUnknown(value: string | null | undefined): DraftStatusOrUnknown {
  return parseDraftStatus(value) ?? "unknown";
}

export function isOcrRunning(status: string | null | undefined): boolean {
  return status === "ocr_running";
}

export function isConfirmed(status: string | null | undefined): boolean {
  return status === "confirmed";
}

const cancelableStatuses: ReadonlySet<DraftStatus> = new Set([
  "ocr_running",
  "ocr_failed",
  "draft_ready",
  "needs_review",
]);

export function isCancelableDraftStatus(status: string | null | undefined): boolean {
  const parsed = parseDraftStatus(status);
  return parsed !== undefined && cancelableStatuses.has(parsed);
}

export function reviewStatusLabel(status: string | null | undefined): string {
  return draftStatusLabels[asDraftStatusOrUnknown(status)];
}
