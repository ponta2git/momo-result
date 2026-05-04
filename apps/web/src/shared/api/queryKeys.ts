/**
 * 横断的に使用される TanStack Query のキーを集約する。
 *
 * - feature 専属でないリソース (held-events, ocr-drafts, ocr-job) のキーをここに集める
 * - 各キーはネスト構造で「全体無効化用」「個別取得用」を表現する
 *
 * すべて純関数で副作用は持たない。
 */
export const heldEventKeys = {
  all: () => ["held-events"] as const,
  scope: (scope: string) => ["held-events", scope] as const,
};

export const ocrDraftKeys = {
  all: () => ["ocr-drafts-bulk"] as const,
  bulk: (draftIdsKey: string) => ["ocr-drafts-bulk", draftIdsKey] as const,
};

export const ocrJobKeys = {
  all: () => ["ocr-job"] as const,
  detail: (jobId: string | undefined) => ["ocr-job", jobId] as const,
};
