package momo.api.http

/**
 * Stable operation labels used by cross-cutting HTTP concerns.
 *
 * These values are persisted in idempotency records and used as rate-limit/log scopes, so changing a
 * label is a compatibility decision rather than a cosmetic route refactor.
 */
object HttpOperation:
  val CreateLoginAccount = "POST /api/admin/login-accounts"
  val UpdateLoginAccount = "PATCH /api/admin/login-accounts"

  val CreateOcrJob = "POST /api/ocr-jobs"
  val GetOcrJob = "GET /api/ocr-jobs/:id"
  val CancelOcrJob = "DELETE /api/ocr-jobs"
  val GetOcrDraft = "GET /api/ocr-drafts/:id"
  val ListOcrDrafts = "GET /api/ocr-drafts"

  val CreateHeldEvent = "POST /api/held-events"
  val DeleteHeldEvent = "DELETE /api/held-events"

  val CreateMatchDraft = "POST /api/match-drafts"
  val UpdateMatchDraft = "PATCH /api/match-drafts/:id"
  val CancelMatchDraft = "POST /api/match-drafts/:id/cancel"

  val ConfirmMatch = "POST /api/matches"
  val ListMatches = "GET /api/matches"
  val SummarizeMatches = "GET /api/matches/summary"
  val UpdateMatch = "PUT /api/matches/:id"
  val DeleteMatch = "DELETE /api/matches/:id"

  val GetSeriesComparisonOptions = "GET /api/analytics/series-comparison/options"
  val GetSeriesComparison = "GET /api/analytics/series-comparison"

  val CreateGameTitle = "POST /api/game-titles"
  val UpdateGameTitle = "PATCH /api/game-titles"
  val DeleteGameTitle = "DELETE /api/game-titles"

  val CreateMapMaster = "POST /api/map-masters"
  val UpdateMapMaster = "PATCH /api/map-masters"
  val DeleteMapMaster = "DELETE /api/map-masters"

  val CreateSeasonMaster = "POST /api/season-masters"
  val UpdateSeasonMaster = "PATCH /api/season-masters"
  val DeleteSeasonMaster = "DELETE /api/season-masters"

  val CreateMemberAlias = "POST /api/member-aliases"
  val UpdateMemberAlias = "PATCH /api/member-aliases"
  val DeleteMemberAlias = "DELETE /api/member-aliases"
end HttpOperation
