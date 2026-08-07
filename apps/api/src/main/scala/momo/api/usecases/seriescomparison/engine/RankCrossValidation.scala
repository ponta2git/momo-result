package momo.api.usecases.seriescomparison.engine

import momo.api.domain.ids.MemberId

private[seriescomparison] object RankAnalysisQualityPolicy:
  private val MinimumMatchCount = 32
  private val MinimumHeldEventCount = 8
  private val OkHeldEventCount = 20
  private val MinimumImprovedFoldCount = 4

  def assess(
      heldEventCount: Int,
      matchCount: Int,
      improvedFoldCount: Int,
      hasStableSignal: Boolean,
  ): (RankAnalysisQuality, Vector[RankAnalysisReason]) =
    val noTargetReasons = Vector(
      Option.when(matchCount < MinimumMatchCount)(RankAnalysisReason.InsufficientMatches),
      Option.when(heldEventCount < MinimumHeldEventCount)(RankAnalysisReason.InsufficientEvents),
    ).flatten
    if noTargetReasons.nonEmpty then
      (RankAnalysisQuality.NoTarget, noTargetReasons)
    else
      val reasons = Vector(
        Option.when(heldEventCount < OkHeldEventCount)(RankAnalysisReason.InsufficientEvents),
        Option.when(improvedFoldCount < MinimumImprovedFoldCount)(
          RankAnalysisReason.ModelNotBetter
        ),
        Option.when(!hasStableSignal)(RankAnalysisReason.UnstableSignals),
      ).flatten
      if reasons.isEmpty then (RankAnalysisQuality.Ok, Vector.empty)
      else (RankAnalysisQuality.Reference, reasons)

private[seriescomparison] object RankCrossValidation:
  def evaluate(
      events: Vector[EncodedRankEvent],
      config: RankAnalysisConfig,
  ): Either[RankAnalysisReason, Vector[FoldRankEvaluation]] = (0 until config.foldCount).foldLeft[
    Either[RankAnalysisReason, Vector[FoldRankEvaluation]]
  ](Right(Vector.empty)) { (accumulated, fold) =>
    for
      evaluations <- accumulated
      evaluation <- evaluateFold(events, fold, config)
    yield evaluations :+ evaluation
  }

  def rankSignals(
      evaluations: Vector[FoldRankEvaluation],
      playerOrder: Vector[MemberId],
      config: RankAnalysisConfig,
  ): Either[RankAnalysisReason, Vector[PlayerRankSignals]] =
    playerOrder.foldLeft[Either[RankAnalysisReason, Vector[PlayerRankSignals]]](
      Right(Vector.empty)
    ) { (accumulated, memberId) =>
      for
        entries <- accumulated
        signals <- signalsForPlayer(evaluations, memberId, config)
      yield entries :+ PlayerRankSignals(memberId, signals)
    }

  def expectedRanks(
      evaluations: Vector[FoldRankEvaluation]
  ): Either[RankAnalysisReason, Map[(String, String), Double]] =
    evaluations.foldLeft[Either[RankAnalysisReason, Map[(String, String), Double]]](
      Right(Map.empty)
    ) { (accumulated, evaluation) =>
      for
        ranks <- accumulated
        foldRanks <- expectedRanksForFold(evaluation)
      yield ranks ++ foldRanks
    }

  private def evaluateFold(
      events: Vector[EncodedRankEvent],
      fold: Int,
      config: RankAnalysisConfig,
  ): Either[RankAnalysisReason, FoldRankEvaluation] =
    val indexedEvents = events.zipWithIndex
    val testEvents = indexedEvents.collect {
      case (event, index) if index % config.foldCount == fold => event
    }
    val trainingEvents = indexedEvents.collect {
      case (event, index) if index % config.foldCount != fold => event
    }
    val trainingPairs = RankFeatureEncoder.pairRecords(trainingEvents)
    val testPairs = RankFeatureEncoder.pairRecords(testEvents)
    if trainingPairs.isEmpty || testPairs.isEmpty then Left(RankAnalysisReason.InvalidDataset)
    else
      for
        baselineFit <- fit(trainingPairs.map(_.baselineObservation), config)
        fullFit <- fit(trainingPairs.map(_.fullObservation), config)
        baselineLogLoss <- logLoss(testPairs.map(_.baselineObservation), baselineFit.coefficients)
        fullLogLoss <- logLoss(testPairs.map(_.fullObservation), fullFit.coefficients)
        baselineBrier <- brier(testPairs.map(_.baselineObservation), baselineFit.coefficients)
        fullBrier <- brier(testPairs.map(_.fullObservation), fullFit.coefficients)
      yield FoldRankEvaluation(
        score = RankFoldScore(
          fold = fold,
          heldEventCount = testEvents.size,
          comparisonCount = testPairs.size,
          baselineLogLoss = baselineLogLoss,
          fullLogLoss = fullLogLoss,
          baselineBrierScore = baselineBrier,
          fullBrierScore = fullBrier,
        ),
        testEvents = testEvents,
        testPairs = testPairs,
        fullFit = fullFit,
      )

  private def signalsForPlayer(
      evaluations: Vector[FoldRankEvaluation],
      memberId: MemberId,
      config: RankAnalysisConfig,
  ): Either[RankAnalysisReason, Vector[PlayerRankSignal]] =
    RankSignalKind.valuesInFeatureOrder.zipWithIndex.foldLeft[
      Either[RankAnalysisReason, Vector[PlayerRankSignal]]
    ](Right(Vector.empty)) { case (accumulated, (kind, signalIndex)) =>
      for
        signals <- accumulated
        signal <- signalForPlayer(evaluations, memberId, kind, signalIndex, config)
      yield signals :+ signal
    }.map { signals =>
      signals.filter(_.importance > 0.0)
        .sortBy(signal => (-signal.importance, signal.kind.ordinal)).take(3)
    }

  private def signalForPlayer(
      evaluations: Vector[FoldRankEvaluation],
      memberId: MemberId,
      kind: RankSignalKind,
      signalIndex: Int,
      config: RankAnalysisConfig,
  ): Either[RankAnalysisReason, PlayerRankSignal] =
    val foldImportances = evaluations.foldLeft[
      Either[RankAnalysisReason, Vector[Double]]
    ](Right(Vector.empty)) { (accumulated, evaluation) =>
      for
        importances <- accumulated
        originalLoss <- memberLogLoss(
          evaluation.testPairs,
          memberId,
          evaluation.fullFit.coefficients,
        )
        permutedPairs = RankFeatureEncoder.pairRecords(
          RankFeatureEncoder.withPermutedSignal(
            evaluation.testEvents,
            memberId,
            signalIndex,
          )
        )
        permutedLoss <- memberLogLoss(
          permutedPairs,
          memberId,
          evaluation.fullFit.coefficients,
        )
      yield importances :+ (permutedLoss - originalLoss)
    }
    foldImportances.map { importances =>
      val coefficients = evaluations.map(_.fullFit.coefficients(signalIndex))
      val foldComparisonCounts = evaluations.map(_.testPairs.count { pair =>
        pair.left.source.memberId == memberId || pair.right.source.memberId == memberId
      })
      val positiveDirections = coefficients.count(_ > 0.0)
      val negativeDirections = coefficients.count(_ < 0.0)
      val direction =
        if positiveDirections >= negativeDirections then RankSignalDirection.MoreIsHigher
        else RankSignalDirection.LessIsHigher
      val directionAgreement = math.max(positiveDirections, negativeDirections)
      val importance = importances.sum / (importances.size * 1.0)
      val stable = directionAgreement >= 4 && importances.count(_ > 0.0) >= 3 &&
        importance >= config.minimumImportance
      PlayerRankSignal(
        kind,
        direction,
        importance,
        importances,
        foldComparisonCounts,
        stable,
      )
    }

  private def expectedRanksForFold(
      evaluation: FoldRankEvaluation
  ): Either[RankAnalysisReason, Map[(String, String), Double]] =
    evaluation.testPairs.groupBy(_.matchId).values.foldLeft[
      Either[RankAnalysisReason, Map[(String, String), Double]]
    ](Right(Map.empty)) { (accumulated, pairs) =>
      val rows = pairs.flatMap(pair => Vector(pair.left, pair.right)).distinctBy(_.source.memberId)
      val initial = rows.map(row => rankKey(row) -> 1.0).toMap
      val matchRanks = pairs.foldLeft[Either[RankAnalysisReason, Map[(String, String), Double]]](
        Right(initial)
      ) { (rankResult, pair) =>
        for
          ranks <- rankResult
          leftAbove <- probability(pair.fullObservation.features, evaluation.fullFit.coefficients)
        yield ranks
          .updatedWith(rankKey(pair.left))(_.map(_ + (1.0 - leftAbove)))
          .updatedWith(rankKey(pair.right))(_.map(_ + leftAbove))
      }
      for
        allRanks <- accumulated
        ranks <- matchRanks
      yield allRanks ++ ranks
    }

  private def memberLogLoss(
      pairs: Vector[PairwiseRankRecord],
      memberId: MemberId,
      coefficients: Vector[Double],
  ): Either[RankAnalysisReason, Double] =
    val observations = pairs.filter { pair =>
      pair.left.source.memberId == memberId || pair.right.source.memberId == memberId
    }.map(_.fullObservation)
    logLoss(observations, coefficients)

  private def fit(
      observations: Vector[PairwiseRankObservation],
      config: RankAnalysisConfig,
  ): Either[RankAnalysisReason, BradleyTerryFit] =
    RegularizedBradleyTerry.fit(observations, config.modelConfig)
      .left.map(_ => RankAnalysisReason.NumericalFailure)

  private def probability(
      features: Vector[Double],
      coefficients: Vector[Double],
  ): Either[RankAnalysisReason, Double] =
    RegularizedBradleyTerry.probability(features, coefficients)
      .left.map(_ => RankAnalysisReason.NumericalFailure)

  private def logLoss(
      observations: Vector[PairwiseRankObservation],
      coefficients: Vector[Double],
  ): Either[RankAnalysisReason, Double] =
    RegularizedBradleyTerry.logLoss(observations, coefficients)
      .left.map(_ => RankAnalysisReason.NumericalFailure)

  private def brier(
      observations: Vector[PairwiseRankObservation],
      coefficients: Vector[Double],
  ): Either[RankAnalysisReason, Double] =
    RegularizedBradleyTerry.brierScore(observations, coefficients)
      .left.map(_ => RankAnalysisReason.NumericalFailure)

  private def rankKey(row: EncodedRankRow): (String, String) =
    (row.source.matchId.value, row.source.memberId.value)

end RankCrossValidation
