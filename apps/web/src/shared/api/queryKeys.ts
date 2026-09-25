/**
 * 横断的に使用される TanStack Query のキーを集約する。
 *
 * Query key は API resource だけでなく、cache に保存する runtime shape も含める。
 * master は API response を保存し、管理画面の並べ替えは select で行う。
 * 認証主体の切替時には cache 全体を破棄し、画面間で同じ response を共有する。
 */
export const heldEventKeys = {
  all: () => ["held-events"] as const,
  list: (params: unknown) => ["held-events", "list-response", params] as const,
  listRoot: () => ["held-events", "list-response"] as const,
  detailRoot: () => ["held-events", "detail"] as const,
  summary: (heldEventId: string | undefined) =>
    ["held-events", "detail", heldEventId, "summary"] as const,
  summaryRead: (heldEventId: string | undefined) =>
    ["held-events", "detail", heldEventId, "summary", "read-result"] as const,
  resource: (heldEventId: string | undefined) => ["held-events", "detail", heldEventId] as const,
  detail: (heldEventId: string | undefined) =>
    ["held-events", "detail", heldEventId, "read-result"] as const,
};

export const adminAccountKeys = {
  all: () => ["admin", "login-accounts"] as const,
};

export const notificationSettingsKeys = {
  all: () => ["admin", "notification-settings"] as const,
};

export const ocrJobKeys = {
  all: () => ["ocr-job"] as const,
  detail: (jobId: string | undefined) => ["ocr-job", jobId] as const,
};

export const ocrDraftKeys = {
  all: () => ["ocr-drafts"] as const,
  bulk: (draftIds: readonly string[]) => ["ocr-drafts", "bulk", draftIds] as const,
  detail: (draftId: string | undefined) => ["ocr-drafts", "detail", draftId] as const,
};

export const masterKeys = {
  all: () => ["masters"] as const,
  gameTitles: {
    all: () => ["masters", "game-titles"] as const,
    list: () => ["masters", "game-titles", "list-response"] as const,
  },
  incidentMasters: {
    all: () => ["masters", "incident-masters"] as const,
    list: () => ["masters", "incident-masters", "list-response"] as const,
  },
  mapMasters: {
    all: () => ["masters", "map-masters"] as const,
    list: (gameTitleId: string | undefined = undefined) =>
      ["masters", "map-masters", "list-response", gameTitleId || "all"] as const,
  },
  memberAliases: {
    all: () => ["masters", "member-aliases"] as const,
    list: () => ["masters", "member-aliases", "list-response"] as const,
  },
  seasonMasters: {
    all: () => ["masters", "season-masters"] as const,
    list: (gameTitleId: string | undefined = undefined) =>
      ["masters", "season-masters", "list-response", gameTitleId || "all"] as const,
  },
};

export const matchKeys = {
  collections: () => ["matches", "collections"] as const,
  list: (search: unknown) => ["matches", "collections", "list", search] as const,
  summary: (params: unknown) => ["matches", "collections", "summary", params] as const,
  exports: (params: unknown) => ["matches", "collections", "exports", params] as const,
  detailRoot: () => ["matches", "detail"] as const,
  identity: (matchId: string | undefined) => ["matches", "detail", matchId, "identity"] as const,
  identityRead: (matchId: string | undefined) =>
    ["matches", "detail", matchId, "identity", "read-result"] as const,
  resource: (matchId: string | undefined) => ["matches", "detail", matchId] as const,
  detail: (matchId: string | undefined) => ["matches", "detail", matchId, "read-result"] as const,
  draft: {
    all: () => ["match-drafts"] as const,
    detailRoot: () => ["match-drafts", "detail"] as const,
    detail: (matchDraftId: string | undefined) => ["match-drafts", "detail", matchDraftId] as const,
    review: (matchDraftId: string | undefined) => ["match-drafts", "review", matchDraftId] as const,
    sourceImagesRoot: () => ["match-drafts", "source-images"] as const,
    sourceImages: (matchDraftId: string | undefined) =>
      ["match-drafts", "source-images", matchDraftId] as const,
    summary: () => ["match-drafts", "summary"] as const,
  },
};

export const sourceImageBlobKeys = {
  draft: (draftId: string) => ["source-image-blobs", draftId] as const,
  scope: (draftId: string, accountId: string | undefined, scope: string) =>
    ["source-image-blobs", draftId, accountId, scope] as const,
  image: (
    draftId: string,
    accountId: string | undefined,
    scope: string,
    kind: string,
    url: string,
    revision: string,
  ) => ["source-image-blobs", draftId, accountId, scope, kind, url, revision] as const,
};

export const seriesAnalysisKeys = {
  all: () => ["series-analysis"] as const,
  options: () => ["series-analysis", "options", "v2"] as const,
  statusRoot: () => ["series-analysis", "status", "v2"] as const,
  status: (gameTitleId: string | undefined) =>
    ["series-analysis", "status", "v2", gameTitleId ?? "none"] as const,
  artifactRoot: () => ["series-analysis", "artifact", "v3"] as const,
  aggregate: (params: unknown) =>
    ["series-analysis", "artifact", "v3", "aggregate", "http-v3", params] as const,
  review: (params: unknown) => ["series-analysis", "artifact", "v3", "review", params] as const,
  drilldown: (params: unknown) =>
    ["series-analysis", "artifact", "v3", "drilldown", params] as const,
  matchContextRoot: () => ["series-analysis", "artifact", "v3", "match-context"] as const,
  matchContext: (params: unknown) =>
    ["series-analysis", "artifact", "v3", "match-context", "http-v3", params] as const,
  adminRoot: () => ["series-analysis", "admin", "overview"] as const,
  adminOverview: (gameTitleId: string | undefined) =>
    ["series-analysis", "admin", "overview", gameTitleId ?? "default"] as const,
};
