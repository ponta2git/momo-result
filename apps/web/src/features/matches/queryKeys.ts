import type { QueryClient } from "@tanstack/react-query";

/**
 * 試合・下書きに関連する Query Key を集約する。
 *
 * - リテラル散在による typo / invalidate 漏れを防ぐ
 * - matches 専属キーのみ保持 (横断キーは @/shared/api/queryKeys へ)
 *
 * すべて純関数で副作用は持たない。
 */
export const matchKeys = {
  all: () => ["matches"] as const,
  list: (search: unknown) => ["matches", "list", search] as const,
  summary: (params: unknown) => ["matches", "summary", params] as const,
  exports: (params: unknown) => ["matches", "exports", params] as const,
  detail: (matchId: string | undefined) => ["match", matchId] as const,
  draft: {
    summary: () => ["match-draft-summary"] as const,
    detail: (matchDraftId: string | undefined) => ["match-draft-detail", matchDraftId] as const,
    sourceImages: (matchDraftId: string | undefined) =>
      ["match-draft-source-images", matchDraftId] as const,
  },
};

/**
 * 試合本体と下書き系キャッシュをまとめて無効化する。
 *
 * `confirm` / `update` / `cancel` で共通の invalidate 集合を 1 か所に集約する。
 * 冪等であり、何度呼んでも結果は同じ（参照透過）。
 */
export async function invalidateMatchAndDraftCaches(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: matchKeys.all() }),
    queryClient.invalidateQueries({ queryKey: matchKeys.draft.summary() }),
    queryClient.invalidateQueries({ queryKey: matchKeys.draft.detail(undefined) }),
  ]);
}

/** 特定の試合詳細 + 試合一覧キャッシュを無効化する。 */
export async function invalidateMatchDetailCaches(
  queryClient: QueryClient,
  matchId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: matchKeys.detail(matchId) }),
    queryClient.invalidateQueries({ queryKey: matchKeys.all() }),
  ]);
}
