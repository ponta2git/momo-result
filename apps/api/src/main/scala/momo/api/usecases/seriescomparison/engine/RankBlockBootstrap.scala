package momo.api.usecases.seriescomparison.engine

import momo.api.domain.ids.MemberId

private[seriescomparison] object RankBlockBootstrap:
  private val SignalFeatureCount = RankSignalKind.valuesInFeatureOrder.size
  private val PlayOrderFeatureCount = 4
  private val TieTolerance = 0.0000000001

  def crownCertainty(
      events: Vector[EncodedRankEvent],
      playerOrder: Vector[MemberId],
      config: RankAnalysisConfig,
  ): Either[RankAnalysisReason, CrownCertainty] =
    val iterations = (0 until config.bootstrapIterations).flatMap { iteration =>
      val sample = Vector.tabulate(events.size) { draw =>
        events(drawIndex(config.bootstrapSeed, iteration, draw, events.size))
      }
      val observations = RankFeatureEncoder.pairRecords(sample).map(_.fullObservation)
      RegularizedBradleyTerry.fit(observations, config.modelConfig).toOption.map { fit =>
        leaders(fit.coefficients, playerOrder.size)
      }
    }.toVector
    val minimumSuccessful = math.max(1, config.bootstrapIterations * 9 / 10)
    if iterations.size < minimumSuccessful then Left(RankAnalysisReason.NumericalFailure)
    else
      val totals = iterations.foldLeft(Vector.fill(playerOrder.size)(0.0)) {
        (current, leaderIndices) =>
          val contribution = 1.0 / (leaderIndices.size * 1.0)
          leaderIndices.foldLeft(current) { (shares, leaderIndex) =>
            shares.updated(leaderIndex, shares(leaderIndex) + contribution)
          }
      }
      val shares = playerOrder.zip(totals).map { case (memberId, total) =>
        CrownShare(memberId, total / (iterations.size * 1.0))
      }
      val primaryLeaders = iterations.map(_.min)
      val leaderChangeCount = primaryLeaders.zip(primaryLeaders.drop(1))
        .count { case (previous, next) => previous != next }
      Right(CrownCertainty(
        bootstrapIterations = config.bootstrapIterations,
        successfulIterations = iterations.size,
        leaderChangeCount = leaderChangeCount,
        shares = shares,
      ))

  private def leaders(coefficients: Vector[Double], playerCount: Int): Vector[Int] =
    val start = SignalFeatureCount + PlayOrderFeatureCount
    val playerCoefficients = coefficients.slice(start, start + playerCount)
    val maximum = playerCoefficients.max
    playerCoefficients.zipWithIndex.collect {
      case (coefficient, index) if math.abs(coefficient - maximum) <= TieTolerance => index
    }

  private def drawIndex(seed: Long, iteration: Int, draw: Int, bound: Int): Int =
    val mixed = mix64(seed ^ (iteration * 0x9e3779b9L) ^ (draw * 0x85ebca6bL))
    ((mixed & Long.MaxValue) % bound).toInt

  private def mix64(input: Long): Long =
    val first = (input ^ (input >>> 30)) * 0xbf58476d1ce4e5b9L
    val second = (first ^ (first >>> 27)) * 0x94d049bb133111ebL
    second ^ (second >>> 31)

end RankBlockBootstrap
