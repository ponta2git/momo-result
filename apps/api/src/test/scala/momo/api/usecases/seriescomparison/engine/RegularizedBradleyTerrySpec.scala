package momo.api.usecases.seriescomparison.engine

import munit.FunSuite

final class RegularizedBradleyTerrySpec extends FunSuite:
  private val Delta = 0.0000000001

  test("fits a regularized pairwise rank model and improves held observations"):
    val observations = Vector(
      observation(Vector(-2.0, 1.0), 0.0),
      observation(Vector(-1.0, 1.0), 0.0),
      observation(Vector(1.0, 1.0), 1.0),
      observation(Vector(2.0, 1.0), 1.0),
    )

    val fit = fitOrFail(observations)
    val lowerProbability = probabilityOrFail(Vector(-2.0, 1.0), fit.coefficients)
    val upperProbability = probabilityOrFail(Vector(2.0, 1.0), fit.coefficients)
    val fittedLogLoss =
      metricOrFail(RegularizedBradleyTerry.logLoss(observations, fit.coefficients))
    val fittedBrier =
      metricOrFail(RegularizedBradleyTerry.brierScore(observations, fit.coefficients))

    assert(fit.iterations > 0)
    assert(fit.objective.isFinite)
    assert(fit.coefficients.forall(_.isFinite))
    assert(fit.coefficients.head > 0.0)
    assertEqualsDouble(fit.coefficients(1), 0.0, Delta)
    assert(lowerProbability < 0.5)
    assert(upperProbability > 0.5)
    assert(fittedLogLoss < math.log(2.0))
    assert(fittedBrier < 0.25)

  test("returns exactly the same fit when observation order changes"):
    val observations = Vector(
      observation(Vector(1.0, 0.0), 1.0),
      observation(Vector(-1.0, 0.0), 0.0),
      observation(Vector(0.5, 1.0), 1.0),
      observation(Vector(-0.5, -1.0), 0.0),
      observation(Vector(0.2, -1.0), 1.0),
    )

    val forward = fitOrFail(observations)
    val reversed = fitOrFail(observations.reverse)

    assertEquals(forward, reversed)

  test("keeps coefficients finite for complete separation and a constant feature"):
    val observations = (1 to 20).toVector.flatMap { index =>
      val magnitude = (index * 1.0) / 20.0
      Vector(
        observation(Vector(magnitude, 1.0), 1.0),
        observation(Vector(-magnitude, 1.0), 0.0),
      )
    }

    val fit = fitOrFail(observations)

    assert(fit.coefficients.forall(_.isFinite))
    assert(fit.coefficients.head > 0.0)
    assertEqualsDouble(fit.coefficients(1), 0.0, Delta)

  test("rejects invalid observations and configuration"):
    val valid = Vector(observation(Vector(1.0), 1.0))

    assertEquals(
      RegularizedBradleyTerry.fit(Vector.empty),
      Left(BradleyTerryFailure.InvalidInput),
    )
    assertEquals(
      RegularizedBradleyTerry.fit(Vector(observation(Vector.empty, 1.0))),
      Left(BradleyTerryFailure.InvalidInput),
    )
    assertEquals(
      RegularizedBradleyTerry.fit(Vector(
        observation(Vector(1.0), 1.0),
        observation(Vector(1.0, 2.0), 0.0),
      )),
      Left(BradleyTerryFailure.InvalidInput),
    )
    assertEquals(
      RegularizedBradleyTerry.fit(Vector(observation(Vector(Double.NaN), 1.0))),
      Left(BradleyTerryFailure.InvalidInput),
    )
    assertEquals(
      RegularizedBradleyTerry.fit(Vector(observation(Vector(1.0), 0.5))),
      Left(BradleyTerryFailure.InvalidInput),
    )
    assertEquals(
      RegularizedBradleyTerry.fit(valid, BradleyTerryConfig(l2Penalty = 0.0)),
      Left(BradleyTerryFailure.InvalidInput),
    )

  test("reports numerical failure instead of leaking non-finite coefficients"):
    val result = RegularizedBradleyTerry.fit(Vector(
      observation(Vector(1.0e200), 1.0),
      observation(Vector(-1.0e200), 0.0),
    ))

    assertEquals(result, Left(BradleyTerryFailure.NumericalFailure))

  test("reports non convergence at the configured iteration boundary"):
    val observations = Vector(
      observation(Vector(-2.0), 0.0),
      observation(Vector(-1.0), 0.0),
      observation(Vector(1.0), 1.0),
      observation(Vector(2.0), 1.0),
    )

    val result = RegularizedBradleyTerry.fit(
      observations,
      BradleyTerryConfig(maxIterations = 1, tolerance = 1.0e-30),
    )

    assertEquals(result, Left(BradleyTerryFailure.NonConverged))

  test("rejects probability and metric dimension mismatches"):
    assertEquals(
      RegularizedBradleyTerry.probability(Vector(1.0), Vector(1.0, 2.0)),
      Left(BradleyTerryFailure.InvalidInput),
    )
    assertEquals(
      RegularizedBradleyTerry.logLoss(
        Vector(observation(Vector(1.0, 2.0), 1.0)),
        Vector(1.0),
      ),
      Left(BradleyTerryFailure.InvalidInput),
    )

  private def fitOrFail(observations: Vector[PairwiseRankObservation]): BradleyTerryFit =
    RegularizedBradleyTerry.fit(observations) match
      case Right(fit) => fit
      case Left(failure) => fail(s"fit failed: $failure")

  private def probabilityOrFail(
      features: Vector[Double],
      coefficients: Vector[Double],
  ): Double =
    RegularizedBradleyTerry.probability(features, coefficients) match
      case Right(value) => value
      case Left(failure) => fail(s"probability failed: $failure")

  private def metricOrFail(result: Either[BradleyTerryFailure, Double]): Double = result match
    case Right(value) => value
    case Left(failure) => fail(s"metric failed: $failure")

  private def observation(
      features: Vector[Double],
      outcome: Double,
  ): PairwiseRankObservation = PairwiseRankObservation(features, outcome)

end RegularizedBradleyTerrySpec
