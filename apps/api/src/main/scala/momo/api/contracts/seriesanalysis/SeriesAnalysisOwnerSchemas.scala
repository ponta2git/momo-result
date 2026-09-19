package momo.api.contracts.seriesanalysis

import momo.api.domain.SeriesAnalysisChunkKind

/** The persisted resource shape for each readable artifact generation. */
private[api] object SeriesAnalysisOwnerSchemas:
  private val legacy = Map(
    SeriesAnalysisChunkKind.Aggregate -> "series-analysis-aggregate-v3.schema.json",
    SeriesAnalysisChunkKind.Review -> "series-analysis-review-v3.schema.json",
    SeriesAnalysisChunkKind.Drilldown -> "series-analysis-drilldown-v3.schema.json",
    SeriesAnalysisChunkKind.MatchContext -> "series-analysis-match-context-v1.schema.json",
  )

  val byArtifactVersion: Map[Int, Map[SeriesAnalysisChunkKind, String]] = Map(
    2 -> legacy,
    3 ->
      legacy.updated(SeriesAnalysisChunkKind.Aggregate, "series-analysis-aggregate-v4.schema.json"),
    4 ->
      legacy.updated(SeriesAnalysisChunkKind.Aggregate, "series-analysis-aggregate-v5.schema.json")
        .updated(SeriesAnalysisChunkKind.Review, "series-analysis-review-v4.schema.json"),
  )

  final case class ResponseShape(fileName: String, artifactVersions: List[Int])

  /** Group shared payload shapes only after restricting them to the HTTP route's generations. */
  def forResponse(
      kind: SeriesAnalysisChunkKind,
      maximumArtifactVersion: Option[Int],
  ): List[ResponseShape] = byArtifactVersion.toList
    .filter { case (version, _) => maximumArtifactVersion.forall(version <= _) }
    .groupMap { case (_, files) => files(kind) } { case (version, _) => version }
    .toList.map { case (fileName, versions) => ResponseShape(fileName, versions.sorted) }
    .sortBy(_.artifactVersions.headOption)
