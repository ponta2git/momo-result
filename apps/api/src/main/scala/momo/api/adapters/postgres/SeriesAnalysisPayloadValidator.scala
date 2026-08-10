package momo.api.adapters.postgres

import io.circe.{Json, JsonObject}

import momo.api.domain.{
  SeriesAnalysisChunkKind,
  SeriesAnalysisChunkRequest,
  SeriesAnalysisDrilldownMetric,
  SeriesAnalysisScope
}

private[postgres] object SeriesAnalysisPayloadValidator:
  private val AggregateKeys = Set(
    "schemaVersion",
    "scope",
    "players",
    "summary",
    "metricsByPlayer",
    "rankDistribution",
    "recentRanks",
    "strategyScatter",
    "playOrderComparison",
    "revenueRankConversion",
    "trends",
    "histograms",
    "headToHead",
    "momentumSwitch",
    "performanceProfiles",
    "assetStyleProfiles",
    "cardShopDestination",
    "matchDigest",
    "matchNoInEvent",
    "rankAnalysis",
    "highlights",
    "dataQuality",
    "metricDefinitions",
    "source",
  )
  private val ReviewKeys = Set(
    "schemaVersion",
    "scope",
    "baseline",
    "commonPlaybookTopics",
    "playbookByPlayer",
    "dataQuality",
  )
  private val DrilldownKeys = Set("schemaVersion", "scope", "player", "payload")
  private val MatchContextKeys =
    Set("schemaVersion", "scope", "matchId", "sourceMatchRevision", "match")
  private val CardKeys = Set(
    "cardId",
    "classification",
    "category",
    "heading",
    "actionHypothesis",
    "triggerCondition",
    "recommendedAction",
    "avoidAction",
    "dataReason",
    "postMatchCheck",
    "plainReason",
    "evidenceStrength",
    "targetCount",
    "evidence",
    "qualityStatus",
    "stabilityBand",
    "supportCount",
    "anchorTarget",
    "actionAdviceScore",
  )
  private val Categories = Set(
    "revenue",
    "destination",
    "assets",
    "playOrder",
    "ginji",
    "recovery",
    "destinationPositive",
    "accident",
  )
  private val Classifications = Set("reproduce", "revise", "verify")

  def validate(
      json: Json,
      request: SeriesAnalysisChunkRequest,
      itemCount: Int,
      sourceMatchRevision: Option[Long],
  ): Boolean = request.kind match
    case SeriesAnalysisChunkKind.Aggregate => validateAggregate(json, request.scope, itemCount)
    case SeriesAnalysisChunkKind.Review => validateReview(json, request.scope, itemCount)
    case SeriesAnalysisChunkKind.Drilldown => validateDrilldown(json, request, itemCount)
    case SeriesAnalysisChunkKind.MatchContext =>
      validateMatchContext(json, request, itemCount, sourceMatchRevision)

  private def validateAggregate(
      json: Json,
      scope: SeriesAnalysisScope,
      itemCount: Int,
  ): Boolean = exactObject(json, AggregateKeys).exists { value =>
    val players = value("players").flatMap(_.asArray).getOrElse(Vector.empty)
    val playerIds = players.flatMap(singleMemberId)
    val metrics = value("metricsByPlayer").flatMap(_.asArray).getOrElse(Vector.empty)
    val denominators = metrics.traverseValues(
      _.asObject.flatMap(objectLong(_, "denominator"))
    )
    schemaAndScope(value, 2, scope) && players.size <= 4 &&
    playerIds.size == players.size && playerIds.distinct.size == playerIds.size &&
    metrics.size == players.size && metrics.forall(metric =>
      metric.hcursor.get[String]("memberId").toOption.exists(playerIds.contains)
    ) && denominators.exists(values =>
      values.forall(_ >= 0) && values.map(BigInt(_)).sum == BigInt(itemCount)
    )
  }

  private def validateReview(
      json: Json,
      scope: SeriesAnalysisScope,
      itemCount: Int,
  ): Boolean = exactObject(json, ReviewKeys).exists { value =>
    val topics = value("commonPlaybookTopics").flatMap(_.asArray).getOrElse(Vector.empty)
    val playbooks = value("playbookByPlayer").flatMap(_.asArray).getOrElse(Vector.empty)
    schemaAndScope(value, 2, scope) && topics.size <= 2 && topics.forall(validateCommonTopic) &&
    playbooks.size == itemCount && playbooks.size <= 4 &&
    playbooks.flatMap(playbookMemberId).distinct.size == playbooks.size &&
    playbooks.forall(validatePlaybook)
  }

  private def validateCommonTopic(json: Json): Boolean = exactObject(
    json,
    Set("topicId", "category", "heading", "detail", "playerIds"),
  ).exists(value =>
    value("category").flatMap(_.asString).exists(Categories.contains) &&
      value("playerIds").flatMap(_.asArray).exists(_.size >= 3)
  )

  private def validatePlaybook(json: Json): Boolean = exactObject(
    json,
    Set("player", "primaryCard", "secondaryCards"),
  ).exists { value =>
    val primary = value("primaryCard")
    val secondary = value("secondaryCards").flatMap(_.asArray).getOrElse(Vector.empty)
    val cards = primary.filterNot(_.isNull).toVector ++ secondary
    singleMemberId(value("player").getOrElse(Json.Null)).nonEmpty && secondary.size <= 2 &&
    (primary.exists(!_.isNull) || secondary.isEmpty) && cards.size <= 3 &&
    cards.forall(validateCard) && cardCategories(cards).exists(values =>
      values.distinct.size == values.size
    )
  }

  private def validateCard(json: Json): Boolean = exactObject(json, CardKeys).exists { value =>
    value("classification").flatMap(_.asString).exists(Classifications.contains) &&
    value("category").flatMap(_.asString).exists(Categories.contains) &&
    objectLong(value, "targetCount").exists(_ >= 3) &&
    value("evidence").flatMap(_.asArray).exists(_.size == 2)
  }

  private def cardCategories(cards: Vector[Json]): Option[Vector[String]] =
    cards.traverseValues(_.hcursor.get[String]("category").toOption)

  private def validateDrilldown(
      json: Json,
      request: SeriesAnalysisChunkRequest,
      itemCount: Int,
  ): Boolean = exactObject(json, DrilldownKeys).exists { value =>
    val playerMatches = request.memberId.exists(expected =>
      value("player").flatMap(singleMemberId).contains(expected.value)
    )
    val detail = value("payload").flatMap(_.asObject)
    val expected = request.metric.map {
      case SeriesAnalysisDrilldownMetric.RankAverageHistory =>
        "rank_average_history" -> Set("kind", "summary", "matchRows", "eventRows")
      case SeriesAnalysisDrilldownMetric.PlayOrderRankHistory =>
        "play_order_rank_history" -> Set("kind", "summary", "seriesByPlayOrder", "rows")
      case SeriesAnalysisDrilldownMetric.RankSignals =>
        "rank_signals" -> Set(
            "kind",
            "method",
            "status",
            "reasonCodes",
            "heldEventCount",
            "matchCount",
            "improvedFoldCount",
            "candidates",
          )
      case SeriesAnalysisDrilldownMetric.UnexpectedWins =>
        "unexpected_wins" -> Set("kind", "summary", "rows")
    }
    schemaAndScope(value, 2, request.scope) && playerMatches && expected.exists {
      case (kind, keys) => detail.exists(detailValue =>
          detailValue.keys.toSet == keys && detailValue("kind").flatMap(_.asString).contains(kind) &&
            historyCountMatches(detailValue, kind, itemCount)
        )
    }
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
  ): Boolean = exactObject(json, MatchContextKeys).exists { value =>
    val matchValue = value("match").flatMap(exactObject(
      _,
      Set("matchIndex", "playedAt", "players", "focusedItemIds", "features"),
    ))
    val players = matchValue.flatMap(_("players")).flatMap(_.asArray).getOrElse(Vector.empty)
    val focused = matchValue.flatMap(_("focusedItemIds")).flatMap(_.asArray).getOrElse(Vector.empty)
    val focusedIds = focused.flatMap(_.asString).filter(_.nonEmpty)
    val features = matchValue.flatMap(_("features")).flatMap(_.asArray).getOrElse(Vector.empty)
    schemaAndScope(value, 1, request.scope) &&
    request.matchId.exists(id => value("matchId").flatMap(_.asString).contains(id.value)) &&
    sourceMatchRevision.exists(revision =>
      value("sourceMatchRevision").flatMap(_.asString).contains(revision.toString)
    ) && players.size == itemCount && players.size <= 4 &&
    focused.size >= players.size * 2 && focused.size <= players.size * 11 + 1 &&
    focusedIds.size == focused.size && focusedIds.distinct.size == focusedIds.size &&
    features.size <= 6 && players.forall(validateContextPlayer) &&
    features.forall(validateContextFeature)
  }

  private def validateContextPlayer(json: Json): Boolean = exactObject(
    json,
    Set(
      "memberId",
      "rank",
      "totalAssetsManYen",
      "revenueManYen",
      "revenueRank",
      "revenueAssetRate",
      "previousRank",
      "cumulativeAverageBefore",
      "cumulativeAverageAfter",
      "cumulativeAverageDelta",
      "cumulativeAverageDirection",
    ),
  ).flatMap(_("memberId")).flatMap(_.asString).exists(_.nonEmpty)

  private def validateContextFeature(json: Json): Boolean = exactObject(
    json,
    Set("featureCode", "source", "priority", "tone", "memberIds", "evidence"),
  ).nonEmpty

  private def schemaAndScope(
      value: JsonObject,
      schemaVersion: Int,
      scope: SeriesAnalysisScope,
  ): Boolean = objectLong(value, "schemaVersion").contains(schemaVersion.toLong) &&
    value("scope").exists(payloadScopeMatches(_, scope))

  private def payloadScopeMatches(json: Json, expected: SeriesAnalysisScope): Boolean =
    val expectedKeys = expected.kind match
      case "overall" => Set("kind", "matchCount")
      case "season" => Set("kind", "seasonMasterId", "matchCount")
      case "map" => Set("kind", "mapMasterId", "matchCount")
      case "season_map" => Set("kind", "seasonMasterId", "mapMasterId", "matchCount")
      case _ => Set.empty
    exactObject(json, expectedKeys).exists { value =>
      value("kind").flatMap(_.asString).contains(expected.kind) &&
      value("seasonMasterId").flatMap(_.asString) == expected.seasonMasterId.map(_.value) &&
      value("mapMasterId").flatMap(_.asString) == expected.mapMasterId.map(_.value) &&
      objectLong(value, "matchCount").exists(_ >= 0)
    }

  private def playbookMemberId(json: Json): Option[String] =
    json.hcursor.downField("player").get[String]("memberId").toOption

  private def singleMemberId(json: Json): Option[String] = exactObject(json, Set("memberId"))
    .flatMap(_("memberId")).flatMap(_.asString).filter(_.nonEmpty)

  private def exactObject(json: Json, keys: Set[String]): Option[JsonObject] =
    json.asObject.filter(_.keys.toSet == keys)

  private def objectLong(value: JsonObject, key: String): Option[Long] =
    value(key).flatMap(_.asNumber).flatMap(_.toLong)

  extension (values: Vector[Json])
    private def traverseValues[A](read: Json => Option[A]): Option[Vector[A]] =
      values.foldLeft(Option(Vector.empty[A]))((result, value) =>
        result.flatMap(current => read(value).map(current :+ _))
      )
