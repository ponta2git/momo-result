package momo.api.adapters.postgres

import java.nio.charset.StandardCharsets

import com.networknt.schema.dialect.{Dialect, Dialects}
import com.networknt.schema.keyword.NonValidationKeyword
import com.networknt.schema.{InputFormat, Schema, SchemaLocation}
import io.circe.{Json, JsonObject}

import momo.api.domain.{
  SeriesAnalysisChunkKind,
  SeriesAnalysisChunkRequest,
  SeriesAnalysisDrilldownMetric,
  SeriesAnalysisScope
}

private[postgres] object SeriesAnalysisPayloadValidator:
  private val MaximumTextBytes = 4096
  private val SchemaResourceDirectory = "momo/api/series-analysis-schemas"
  private val OwnerDialect = Dialect
    .builder(Dialects.getDraft202012())
    .keyword(new NonValidationKeyword("x-momo-discriminator"))
    .keyword(new NonValidationKeyword("x-momo-finiteF64"))
    .keyword(new NonValidationKeyword("x-momo-integerToken"))
    .keyword(new NonValidationKeyword("x-momo-maxUtf8Bytes"))
    .keyword(new NonValidationKeyword("x-momo-metricId"))
    .build()
  private val Registry =
    com.networknt.schema.SchemaRegistry.withDialect(OwnerDialect)
  private val AggregateSchema = loadSchema("series-analysis-aggregate-v3.schema.json")
  private val ReviewSchema = loadSchema("series-analysis-review-v3.schema.json")
  private val DrilldownSchema = loadSchema("series-analysis-drilldown-v3.schema.json")
  private val MatchContextSchema = loadSchema("series-analysis-match-context-v1.schema.json")

  private[postgres] def ensureReady(): Unit =
    AggregateSchema.initializeValidators()
    ReviewSchema.initializeValidators()
    DrilldownSchema.initializeValidators()
    MatchContextSchema.initializeValidators()

  def validate(
      json: Json,
      request: SeriesAnalysisChunkRequest,
      itemCount: Int,
      sourceMatchRevision: Option[Long],
  ): Boolean = stringsWithinOwnerBounds(json) && validateShape(json, request.kind) &&
    (request.kind match
      case SeriesAnalysisChunkKind.Aggregate => validateAggregate(json, request.scope, itemCount)
      case SeriesAnalysisChunkKind.Review => validateReview(json, request.scope, itemCount)
      case SeriesAnalysisChunkKind.Drilldown => validateDrilldown(json, request, itemCount)
      case SeriesAnalysisChunkKind.MatchContext =>
        validateMatchContext(json, request, itemCount, sourceMatchRevision))

  /** Enforces the Rust owner's byte bound that portable JSON Schema `maxLength` cannot express. */
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
    val schema = kind match
      case SeriesAnalysisChunkKind.Aggregate => AggregateSchema
      case SeriesAnalysisChunkKind.Review => ReviewSchema
      case SeriesAnalysisChunkKind.Drilldown => DrilldownSchema
      case SeriesAnalysisChunkKind.MatchContext => MatchContextSchema
    schema.validate(json.noSpaces, InputFormat.JSON).isEmpty

  private def validateAggregate(
      json: Json,
      scope: SeriesAnalysisScope,
      itemCount: Int,
  ): Boolean = json.asObject.exists { value =>
    val players = value("players").flatMap(_.asArray).getOrElse(Vector.empty)
    val playerIds = players.flatMap(singleMemberId)
    val metrics = value("metricsByPlayer").flatMap(_.asArray).getOrElse(Vector.empty)
    val denominators = metrics.traverseValues(
      _.asObject.flatMap(objectLong(_, "denominator"))
    )
    value("scope").exists(payloadScopeMatches(_, scope)) &&
    playerIds.size == players.size && playerIds.distinct.size == playerIds.size &&
    metrics.size == players.size && metrics.forall(metric =>
      metric.hcursor.get[String]("memberId").toOption.exists(playerIds.contains)
    ) && denominators.exists(_.map(BigInt(_)).sum == BigInt(itemCount)) &&
    validateMatchNumberEntries(value, playerIds)
  }

  private def validateMatchNumberEntries(
      value: JsonObject,
      playerOrder: Vector[String],
  ): Boolean =
    val entries = value("matchNoInEvent")
      .flatMap(_.asObject).flatMap(_("entries")).flatMap(_.asArray).getOrElse(Vector.empty)
    entries.traverseValues(entry => entry.hcursor.get[Long]("matchNoInEvent").toOption).exists {
      numbers =>
        numbers.forall(_ > 0) && numbers.zip(numbers.drop(1)).forall(_ < _) &&
        entries.zip(numbers).forall { case (entry, number) =>
          val expectedCategory = if number <= 4 then "regular" else "additional"
          entry.hcursor.get[String]("category").toOption.contains(expectedCategory) &&
          entry.hcursor.downField("players").focus.flatMap(_.asArray)
            .flatMap(_.traverseValues(singleMemberId)).contains(playerOrder)
        }
    }

  private def validateReview(
      json: Json,
      scope: SeriesAnalysisScope,
      itemCount: Int,
  ): Boolean = json.asObject.exists { value =>
    val topics = value("commonPlaybookTopics").flatMap(_.asArray).getOrElse(Vector.empty)
    val playbooks = value("playbookByPlayer").flatMap(_.asArray).getOrElse(Vector.empty)
    value("scope").exists(payloadScopeMatches(_, scope)) && topics.forall(validateCommonTopic) &&
    playbooks.size == itemCount &&
    playbooks.flatMap(playbookMemberId).distinct.size == playbooks.size &&
    playbooks.forall(validatePlaybook)
  }

  private def validateCommonTopic(json: Json): Boolean = json.asObject.exists(
    _("playerIds").flatMap(_.asArray).exists(_.size >= 3)
  )

  private def validatePlaybook(json: Json): Boolean = json.asObject.exists { value =>
    val primary = value("primaryCard")
    val secondary = value("secondaryCards").flatMap(_.asArray).getOrElse(Vector.empty)
    val cards = primary.filterNot(_.isNull).toVector ++ secondary
    singleMemberId(value("player").getOrElse(Json.Null)).nonEmpty &&
    (primary.exists(!_.isNull) || secondary.isEmpty) && cards.size <= 3 &&
    cards.forall(validateCard) && cardCategories(cards).exists(values =>
      values.distinct.size == values.size
    )
  }

  private def validateCard(json: Json): Boolean =
    json.asObject.exists(objectLong(_, "targetCount").exists(_ >= 3))

  private def cardCategories(cards: Vector[Json]): Option[Vector[String]] =
    cards.traverseValues(_.hcursor.get[String]("category").toOption)

  private def validateDrilldown(
      json: Json,
      request: SeriesAnalysisChunkRequest,
      itemCount: Int,
  ): Boolean = json.asObject.exists { value =>
    val playerMatches = request.memberId.exists(expected =>
      value("player").flatMap(singleMemberId).contains(expected.value)
    )
    val detail = value("payload").flatMap(_.asObject)
    val expected = request.metric.map {
      case SeriesAnalysisDrilldownMetric.RankAverageHistory =>
        "rank_average_history"
      case SeriesAnalysisDrilldownMetric.PlayOrderRankHistory =>
        "play_order_rank_history"
      case SeriesAnalysisDrilldownMetric.RankSignals =>
        "rank_signals"
      case SeriesAnalysisDrilldownMetric.UnexpectedWins =>
        "unexpected_wins"
    }
    value("scope").exists(payloadScopeMatches(_, request.scope)) && playerMatches &&
    expected.exists(kind =>
      detail.exists(detailValue =>
        detailValue("kind").flatMap(_.asString).contains(kind) &&
          historyCountMatches(detailValue, kind, itemCount)
      )
    )
  }

  private def historyCountMatches(value: JsonObject, kind: String, itemCount: Int): Boolean =
    if Set("rank_average_history", "play_order_rank_history").contains(kind) then
      value("summary").flatMap(_.asObject).flatMap(objectLong(_, "targetCount"))
        .contains(itemCount.toLong)
    else true

  private def validateMatchContext(
      json: Json,
      request: SeriesAnalysisChunkRequest,
      itemCount: Int,
      sourceMatchRevision: Option[Long],
  ): Boolean = json.asObject.exists { value =>
    val matchValue = value("match").flatMap(_.asObject)
    val players = matchValue.flatMap(_("players")).flatMap(_.asArray).getOrElse(Vector.empty)
    val focused = matchValue.flatMap(_("focusedItemIds")).flatMap(_.asArray).getOrElse(Vector.empty)
    val focusedIds = focused.flatMap(_.asString).filter(_.nonEmpty)
    val ranks = players.flatMap(_.hcursor.get[Long]("rank").toOption)
    val features = matchValue.flatMap(_("features")).flatMap(_.asArray).getOrElse(Vector.empty)
    val featureCodes = features.flatMap(_.hcursor.get[String]("featureCode").toOption)
    val featureMemberIds = features.flatMap(
      _.hcursor.get[Vector[String]]("memberIds").getOrElse(Vector.empty)
    )
    val matchPlayerIds = playerIds(players)
    value("scope").exists(payloadScopeMatches(_, request.scope)) &&
    request.matchId.exists(id => value("matchId").flatMap(_.asString).contains(id.value)) &&
    sourceMatchRevision.exists(revision =>
      value("sourceMatchRevision").flatMap(_.asString).contains(revision.toString)
    ) && players.size == itemCount && ranks.size == players.size &&
    ranks.distinct.size == ranks.size &&
    matchValue.flatMap(objectLong(_, "matchIndex")).exists(_ > 0) &&
    focused.size >= players.size * 2 && focused.size <= players.size * 12 + 1 &&
    focusedIds.size == focused.size && focusedIds.distinct.size == focusedIds.size &&
    featureCodes.size == features.size && featureCodes.distinct.size == featureCodes.size &&
    featureMemberIds.forall(matchPlayerIds.contains)
  }

  private def playerIds(players: Vector[Json]): Set[String] =
    players.flatMap(singleMemberId).toSet

  private def payloadScopeMatches(json: Json, expected: SeriesAnalysisScope): Boolean =
    json.asObject.exists { value =>
      value("kind").flatMap(_.asString).contains(expected.kind) &&
      value("seasonMasterId").flatMap(_.asString) == expected.seasonMasterId.map(_.value) &&
      value("mapMasterId").flatMap(_.asString) == expected.mapMasterId.map(_.value) &&
      objectLong(value, "matchCount").exists(_ >= 0)
    }

  private def playbookMemberId(json: Json): Option[String] =
    json.hcursor.downField("player").get[String]("memberId").toOption

  private def singleMemberId(json: Json): Option[String] =
    json.hcursor.get[String]("memberId").toOption.filter(_.nonEmpty)

  private def objectLong(value: JsonObject, key: String): Option[Long] =
    value(key).flatMap(_.asNumber).flatMap(_.toLong)

  extension (values: Vector[Json])
    private def traverseValues[A](read: Json => Option[A]): Option[Vector[A]] =
      values.foldLeft(Option(Vector.empty[A]))((result, value) =>
        result.flatMap(current => read(value).map(current :+ _))
      )
