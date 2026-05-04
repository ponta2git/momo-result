import type { QueryClient } from "@tanstack/react-query";

/**
 * 試合・下書きに関連する Query Key を集約して第一級オブジェクト化する。
 *
 * - リテラル散在による typo / invalidate 漏れを防ぐ
 * - 「この key はどこに依存するか」を 1 か所で確認できる
 * - 列挙ヘルパ (`matchCacheKeys.all`) を介して invalidate を冪等に行える
 *
 * すべて純関数で副作用は持たない。
 */
export const matchKeys = {
  list: (search: unknown) => ["matches", "list", search] as const,
  matches: () => ["matches"] as const,
  matchesScoped: (scope: string, params?: unknown) =>
    params === undefined ? (["matches", scope] as const) : (["matches", scope, params] as const),
  matchDetail: (matchId: string | undefined) => ["match", matchId] as const,
  matchDraftSummary: () => ["match-draft-summary"] as const,
  matchDraftDetail: (matchDraftId: string | undefined) =>
    ["match-draft-detail", matchDraftId] as const,
  matchDraftSourceImages: (matchDraftId: string | undefined) =>
    ["match-draft-source-images", matchDraftId] as const,
  ocrDraftsBulk: (draftIdsKey: string) => ["ocr-drafts-bulk", draftIdsKey] as const,
  ocrJob: (jobId: string | undefined) => ["ocr-job", jobId] as const,
  heldEvents: (scope: string) => ["held-events", scope] as const,
};

/**
 * 試合・下書き系キャッシュをまとめて無効化する。
 *
 * `confirm` / `update` / `cancel` で同じ invalidate 集合を毎回複製していた問題を解消する。
 * 冪等であり、何度呼んでも結果は同じ（参照透過）。
 */
export async function invalidateMatchCaches(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: matchKeys.matches() }),
    queryClient.invalidateQueries({ queryKey: matchKeys.matchDraftSummary() }),
    queryClient.invalidateQueries({ queryKey: matchKeys.matchDraftDetail(undefined) }),
  ]);
}

/** 特定の試合詳細 + 一覧キャッシュを無効化する。 */
export async function invalidateMatchDetailCaches(
  queryClient: QueryClient,
  matchId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: matchKeys.matchDetail(matchId) }),
    queryClient.invalidateQueries({ queryKey: matchKeys.matches() }),
  ]);
}
