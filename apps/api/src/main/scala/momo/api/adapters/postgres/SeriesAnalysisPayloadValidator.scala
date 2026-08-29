package momo.api.adapters.postgres

import java.nio.charset.StandardCharsets

import com.networknt.schema.dialect.{Dialect, Dialects}
import com.networknt.schema.keyword.NonValidationKeyword
import com.networknt.schema.{InputFormat, Schema, SchemaLocation}
import io.circe.Json
import io.circe.parser.parse

import momo.api.domain.{
  SeriesAnalysisChunkKind,
  SeriesAnalysisChunkRequest,
  SeriesAnalysisDrilldownMetric,
  SeriesAnalysisScope
}

/**
 * Reader-side defense for an immutable, Rust-attested artifact.
 *
 * Rust owns calculation semantics, canonical encoding, and cross-resource consistency before
 * publication. The API deliberately checks only the generated resource shape, portable byte
 * bounds, and the request identity that selects this stored chunk.
 */
private[postgres] object SeriesAnalysisPayloadValidator:
  private val SchemaResourceDirectory = "momo/api/series-analysis-schemas"
  private val SchemaFiles = Map(
    SeriesAnalysisChunkKind.Aggregate -> "series-analysis-aggregate-v3.schema.json",
    SeriesAnalysisChunkKind.Review -> "series-analysis-review-v3.schema.json",
    SeriesAnalysisChunkKind.Drilldown -> "series-analysis-drilldown-v3.schema.json",
    SeriesAnalysisChunkKind.MatchContext -> "series-analysis-match-context-v1.schema.json",
  )
  private val OwnerDialect = Dialect
    .builder(Dialects.getDraft202012())
    .keyword(new NonValidationKeyword("x-momo-discriminator"))
    .keyword(new NonValidationKeyword("x-momo-finiteF64"))
    .keyword(new NonValidationKeyword("x-momo-integerToken"))
    .keyword(new NonValidationKeyword("x-momo-maxUtf8Bytes"))
    .keyword(new NonValidationKeyword("x-momo-metricId"))
    .build()
  private val Registry = com.networknt.schema.SchemaRegistry.withDialect(OwnerDialect)
  private val Schemas = SchemaFiles.view.mapValues(loadSchema).toMap
  private val MaximumTextBytes = ownerMaximumTextBytes(SchemaFiles.values.toSet)

  private[postgres] def ensureReady(): Unit = Schemas.values.foreach(_.initializeValidators())

  def validate(
      json: Json,
      request: SeriesAnalysisChunkRequest,
      sourceMatchRevision: Option[Long],
  ): Boolean = stringsWithinOwnerBounds(json) && validateShape(json, request.kind) &&
    payloadIdentityMatches(json, request, sourceMatchRevision)

  /** JSON Schema maxLength counts code points, while the producer contract bounds UTF-8 bytes. */
  private def stringsWithinOwnerBounds(json: Json): Boolean = json.arrayOrObject(
    json.asString.forall(utf8Length(_) <= MaximumTextBytes),
    _.forall(stringsWithinOwnerBounds),
    fields =>
      fields.toIterable.forall { case (key, value) =>
        utf8Length(key) <= MaximumTextBytes && stringsWithinOwnerBounds(value)
      },
  )

  private def utf8Length(value: String): Int = value.getBytes(StandardCharsets.UTF_8).length

  private def loadSchema(fileName: String): Schema =
    val resourcePath = s"$SchemaResourceDirectory/$fileName"
    val _ = Option(getClass.getResource(s"/$resourcePath")).getOrElse(
      sys.error(s"Series analysis resource schema is missing: $resourcePath")
    )
    val schema = Registry.getSchema(SchemaLocation.of(s"classpath:$resourcePath"))
    schema.initializeValidators()
    schema

  private def validateShape(json: Json, kind: SeriesAnalysisChunkKind): Boolean =
    Schemas(kind).validate(json.noSpaces, InputFormat.JSON).isEmpty

  private def payloadIdentityMatches(
      json: Json,
      request: SeriesAnalysisChunkRequest,
      sourceMatchRevision: Option[Long],
  ): Boolean = json.asObject.exists { value =>
    val scopeMatches = value("scope").exists(payloadScopeMatches(_, request.scope))
    request.kind match
      case SeriesAnalysisChunkKind.Aggregate | SeriesAnalysisChunkKind.Review => scopeMatches
      case SeriesAnalysisChunkKind.Drilldown =>
        val memberMatches = request.memberId.exists(expected =>
          value("player").flatMap(singleMemberId).contains(expected.value)
        )
        val metricKind = request.metric.map {
          case SeriesAnalysisDrilldownMetric.RankAverageHistory => "rank_average_history"
          case SeriesAnalysisDrilldownMetric.PlayOrderRankHistory => "play_order_rank_history"
          case SeriesAnalysisDrilldownMetric.RankSignals => "rank_signals"
          case SeriesAnalysisDrilldownMetric.UnexpectedWins => "unexpected_wins"
        }
        val kindMatches = metricKind.exists(expected =>
          value("payload").flatMap(_.hcursor.get[String]("kind").toOption).contains(expected)
        )
        scopeMatches && memberMatches && kindMatches
      case SeriesAnalysisChunkKind.MatchContext =>
        val matchMatches = request.matchId.exists(expected =>
          value("matchId").flatMap(_.asString).contains(expected.value)
        )
        val revisionMatches = sourceMatchRevision.exists(expected =>
          value("sourceMatchRevision").flatMap(_.asString).contains(expected.toString)
        )
        scopeMatches && matchMatches && revisionMatches
  }

  private def payloadScopeMatches(json: Json, expected: SeriesAnalysisScope): Boolean =
    json.asObject.exists { value =>
      value("kind").flatMap(_.asString).contains(expected.kind) &&
      value("seasonMasterId").flatMap(_.asString) == expected.seasonMasterId.map(_.value) &&
      value("mapMasterId").flatMap(_.asString) == expected.mapMasterId.map(_.value)
    }

  private def singleMemberId(json: Json): Option[String] =
    json.hcursor.get[String]("memberId").toOption.filter(_.nonEmpty)

  private def ownerMaximumTextBytes(fileNames: Set[String]): Int =
    val bounds = fileNames.flatMap(fileName => annotationValues(loadSchemaDocument(fileName)))
    bounds.toList match
      case maximum :: Nil if maximum > 0 => maximum
      case _ => sys.error("Series analysis owner schemas disagree on x-momo-maxUtf8Bytes")

  private def annotationValues(json: Json): Set[Int] = json.arrayOrObject(
    Set.empty,
    _.flatMap(annotationValues).toSet,
    fields =>
      fields("x-momo-maxUtf8Bytes").flatMap(_.asNumber).flatMap(_.toInt).toSet ++
        fields.values.flatMap(annotationValues),
  )

  private def loadSchemaDocument(fileName: String): Json =
    val resourcePath = s"$SchemaResourceDirectory/$fileName"
    val stream = resource(resourcePath)
    try
      parse(new String(stream.readAllBytes(), StandardCharsets.UTF_8))
        .fold(
          error =>
            sys.error(s"Invalid Series analysis resource schema $resourcePath: $error"),
          identity
        )
    finally stream.close()

  private def resource(resourcePath: String): java.io.InputStream = Option(
    getClass.getResourceAsStream(s"/$resourcePath")
  ).getOrElse(sys.error(s"Series analysis resource schema is missing: $resourcePath"))

end SeriesAnalysisPayloadValidator
