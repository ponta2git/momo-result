/**
 * 横断的に使用される TanStack Query のキーを集約する。
 *
 * Query key は API resource だけでなく、cache に保存する runtime shape も含める。
 * 例えば master の管理画面は配列を保存し、通常画面は API response object を保存するため、
 * 同じ resource でも `adminList` と `list` を別 key にする。
 * `list` / `scope` の引数は既存呼び出し互換の画面名で、同じ runtime shape なら key には含めない。
 */
export const heldEventKeys = {
  all: () => ["held-events"] as const,
  list: (params: unknown) => ["held-events", "list-response", params] as const,
  scope: (_scope: string) => ["held-events", "list-response"] as const,
  detailRoot: () => ["held-events", "detail"] as const,
  detail: (heldEventId: string | undefined) => ["held-events", "detail", heldEventId] as const,
};

export const adminAccountKeys = {
  all: () => ["admin", "login-accounts"] as const,
};

export const ocrJobKeys = {
  all: () => ["ocr-job"] as const,
  detail: (jobId: string | undefined) => ["ocr-job", jobId] as const,
};

export const ocrDraftKeys = {
  all: () => ["ocr-drafts-bulk"] as const,
  bulk: (draftIds: readonly string[]) => ["ocr-drafts-bulk", draftIds] as const,
};

export const masterKeys = {
  all: () => ["masters"] as const,
  gameTitles: {
    all: () => ["masters", "game-titles"] as const,
    adminList: (authScope: string) => ["masters", "game-titles", "admin-list", authScope] as const,
    list: (_scope: string) => ["masters", "game-titles", "list-response"] as const,
  },
  incidentMasters: {
    all: () => ["masters", "incident-masters"] as const,
    adminList: (authScope: string) =>
      ["masters", "incident-masters", "admin-list", authScope] as const,
  },
  mapMasters: {
    all: () => ["masters", "map-masters"] as const,
    adminList: (authScope: string, gameTitleId: string) =>
      ["masters", "map-masters", "admin-list", authScope, gameTitleId || "none"] as const,
    list: (_scope: string, gameTitleId: string | undefined = undefined) =>
      ["masters", "map-masters", "list-response", gameTitleId || "all"] as const,
  },
  memberAliases: {
    all: () => ["masters", "member-aliases"] as const,
    adminList: (authScope: string) =>
      ["masters", "member-aliases", "admin-list", authScope] as const,
    list: (_scope: string) => ["masters", "member-aliases", "list-response"] as const,
  },
  seasonMasters: {
    all: () => ["masters", "season-masters"] as const,
    adminList: (authScope: string, gameTitleId: string) =>
      ["masters", "season-masters", "admin-list", authScope, gameTitleId || "none"] as const,
    list: (_scope: string, gameTitleId: string | undefined = undefined) =>
      ["masters", "season-masters", "list-response", gameTitleId || "all"] as const,
  },
};

export const matchKeys = {
  all: () => ["matches"] as const,
  list: (search: unknown) => ["matches", "list", search] as const,
  summary: (params: unknown) => ["matches", "summary", params] as const,
  exports: (params: unknown) => ["matches", "exports", params] as const,
  detailRoot: () => ["matches", "detail"] as const,
  detail: (matchId: string | undefined) => ["matches", "detail", matchId] as const,
  draft: {
    all: () => ["match-drafts"] as const,
    detailRoot: () => ["match-drafts", "detail"] as const,
    detail: (matchDraftId: string | undefined) => ["match-drafts", "detail", matchDraftId] as const,
    sourceImagesRoot: () => ["match-drafts", "source-images"] as const,
    sourceImages: (matchDraftId: string | undefined) =>
      ["match-drafts", "source-images", matchDraftId] as const,
    summary: () => ["match-drafts", "summary"] as const,
  },
};

export const seriesAnalysisKeys = {
  all: () => ["series-analysis"] as const,
  options: () => ["series-analysis", "options", "v2"] as const,
  statusRoot: () => ["series-analysis", "status", "v2"] as const,
  status: (gameTitleId: string | undefined) =>
    ["series-analysis", "status", "v2", gameTitleId ?? "none"] as const,
  artifactRoot: () => ["series-analysis", "artifact", "v2"] as const,
  aggregate: (params: unknown) =>
    ["series-analysis", "artifact", "v2", "aggregate", params] as const,
  review: (params: unknown) => ["series-analysis", "artifact", "v2", "review", params] as const,
  drilldown: (params: unknown) =>
    ["series-analysis", "artifact", "v2", "drilldown", params] as const,
  matchContext: (params: unknown) =>
    ["series-analysis", "artifact", "v2", "match-context", params] as const,
  adminRoot: () => ["series-analysis", "admin", "overview"] as const,
  adminOverview: (gameTitleId: string | undefined) =>
    ["series-analysis", "admin", "overview", gameTitleId ?? "default"] as const,
};
