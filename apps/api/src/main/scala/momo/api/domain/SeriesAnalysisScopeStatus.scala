package momo.api.domain

import momo.api.domain.ids.GameTitleId

final case class SeriesAnalysisScopeStatusRequest(
    gameTitleId: GameTitleId,
    artifactId: Option[String],
    scope: SeriesAnalysisScope,
)

final case class SeriesAnalysisScopeStatus(
    gameTitleId: GameTitleId,
    artifactId: Option[String],
    scope: SeriesAnalysisScope,
    state: String,
    seasonName: Option[String],
    mapName: Option[String],
    invalidFields: List[String],
    currentHasMatches: Boolean,
    publishedHasMatches: Option[Boolean],
)
