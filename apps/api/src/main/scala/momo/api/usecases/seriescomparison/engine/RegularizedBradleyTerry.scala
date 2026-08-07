package momo.api.usecases.seriescomparison.engine

import scala.annotation.tailrec

private[seriescomparison] final case class PairwiseRankObservation(
    features: Vector[Double],
    outcome: Double,
)

private[seriescomparison] final case class BradleyTerryConfig(
    l2Penalty: Double = 1.0,
    maxIterations: Int = 100,
    tolerance: Double = 0.00000001,
    minimumStepScale: Double = 0.00000001,
)

private[seriescomparison] enum BradleyTerryFailure:
  case InvalidInput
  case NumericalFailure
  case NonConverged

private[seriescomparison] final case class BradleyTerryFit(
    coefficients: Vector[Double],
    iterations: Int,
    objective: Double,
)

private[seriescomparison] object RegularizedBradleyTerry:
  private val ProbabilityFloor = 0.000000000000001
  private val ArmijoFactor = 0.0001

  def fit(
      observations: Vector[PairwiseRankObservation]
  ): Either[BradleyTerryFailure, BradleyTerryFit] =
    fit(observations, BradleyTerryConfig())

  def fit(
      observations: Vector[PairwiseRankObservation],
      config: BradleyTerryConfig,
  ): Either[BradleyTerryFailure, BradleyTerryFit] =
    validate(observations, config).flatMap { dimension =>
      val ordered = observations.sortWith(observationComesBefore)
      iterate(
        ordered,
        config,
        Vector.fill(dimension)(0.0),
        iteration = 0,
      )
    }

  def probability(
      features: Vector[Double],
      coefficients: Vector[Double],
  ): Either[BradleyTerryFailure, Double] =
    if features.isEmpty || features.size != coefficients.size ||
        !features.forall(_.isFinite) || !coefficients.forall(_.isFinite)
    then Left(BradleyTerryFailure.InvalidInput)
    else
      val linearPredictor = dot(features, coefficients)
      if !linearPredictor.isFinite then Left(BradleyTerryFailure.NumericalFailure)
      else Right(sigmoid(linearPredictor))

  def logLoss(
      observations: Vector[PairwiseRankObservation],
      coefficients: Vector[Double],
  ): Either[BradleyTerryFailure, Double] =
    metric(observations, coefficients) { (outcome, predicted) =>
      val probability = clampProbability(predicted)
      -(outcome * math.log(probability) + (1.0 - outcome) * math.log(1.0 - probability))
    }

  def brierScore(
      observations: Vector[PairwiseRankObservation],
      coefficients: Vector[Double],
  ): Either[BradleyTerryFailure, Double] =
    metric(observations, coefficients) { (outcome, predicted) =>
      val error = predicted - outcome
      error * error
    }

  private def iterate(
      observations: Vector[PairwiseRankObservation],
      config: BradleyTerryConfig,
      coefficients: Vector[Double],
      iteration: Int,
  ): Either[BradleyTerryFailure, BradleyTerryFit] =
    objectiveGradientHessian(observations, coefficients, config.l2Penalty).flatMap {
      case (currentObjective, gradient, hessian) =>
        if maxAbsolute(gradient) <= config.tolerance then
          Right(BradleyTerryFit(coefficients, iteration, currentObjective))
        else if iteration >= config.maxIterations then Left(BradleyTerryFailure.NonConverged)
        else
          DenseLinearSystem.solve(hessian, gradient).flatMap { newtonStep =>
            findAcceptedStep(
              observations,
              coefficients,
              newtonStep,
              gradient,
              currentObjective,
              config,
            ).flatMap { case (nextCoefficients, stepScale, nextObjective) =>
              val scaledStepMaximum = maxAbsolute(newtonStep) * stepScale
              if scaledStepMaximum <= config.tolerance then
                Right(BradleyTerryFit(nextCoefficients, iteration + 1, nextObjective))
              else iterate(observations, config, nextCoefficients, iteration + 1)
            }
          }
    }

  private def findAcceptedStep(
      observations: Vector[PairwiseRankObservation],
      coefficients: Vector[Double],
      newtonStep: Vector[Double],
      gradient: Vector[Double],
      currentObjective: Double,
      config: BradleyTerryConfig,
  ): Either[BradleyTerryFailure, (Vector[Double], Double, Double)] =
    val directionalDecrease = dot(gradient, newtonStep)
    if !directionalDecrease.isFinite || directionalDecrease <= 0.0 then
      Left(BradleyTerryFailure.NumericalFailure)
    else
      def search(stepScale: Double): Either[BradleyTerryFailure, (Vector[Double], Double, Double)] =
        if stepScale < config.minimumStepScale then Left(BradleyTerryFailure.NumericalFailure)
        else
          val candidate = coefficients.zip(newtonStep).map { case (coefficient, step) =>
            coefficient - stepScale * step
          }
          objective(observations, candidate, config.l2Penalty).flatMap { candidateObjective =>
            val requiredMaximum =
              currentObjective - ArmijoFactor * stepScale * directionalDecrease
            if candidateObjective <= requiredMaximum then
              Right((candidate, stepScale, candidateObjective))
            else search(stepScale / 2.0)
          }

      search(1.0)

  private def objectiveGradientHessian(
      observations: Vector[PairwiseRankObservation],
      coefficients: Vector[Double],
      l2Penalty: Double,
  ): Either[BradleyTerryFailure, (Double, Vector[Double], Vector[Vector[Double]])] =
    val dimension = coefficients.size
    val gradient = Array.fill(dimension)(0.0)
    val hessian = Array.fill(dimension, dimension)(0.0)
    val loss = observations.map { observation =>
      val predicted = sigmoid(dot(observation.features, coefficients))
      val probability = clampProbability(predicted)
      val residual = predicted - observation.outcome
      val curvature = predicted * (1.0 - predicted)
      observation.features.indices.foreach { row =>
        val rowFeature = observation.features(row)
        gradient(row) += residual * rowFeature
        observation.features.indices.foreach { column =>
          hessian(row)(column) += curvature * rowFeature * observation.features(column)
        }
      }
      -(observation.outcome * math.log(probability) +
        (1.0 - observation.outcome) * math.log(1.0 - probability))
    }.sum

    coefficients.indices.foreach { index =>
      val coefficient = coefficients(index)
      gradient(index) += l2Penalty * coefficient
      hessian(index)(index) += l2Penalty
    }

    val penalizedLoss = loss + 0.5 * l2Penalty * coefficients.map(value => value * value).sum

    val gradientVector = gradient.toVector
    val hessianVector = hessian.map(_.toVector).toVector
    if !penalizedLoss.isFinite || !gradientVector.forall(_.isFinite) ||
        !hessianVector.forall(_.forall(_.isFinite))
    then Left(BradleyTerryFailure.NumericalFailure)
    else Right((penalizedLoss, gradientVector, hessianVector))

  private def objective(
      observations: Vector[PairwiseRankObservation],
      coefficients: Vector[Double],
      l2Penalty: Double,
  ): Either[BradleyTerryFailure, Double] =
    val loss = observations.foldLeft(0.0) { (total, observation) =>
      val probability = clampProbability(sigmoid(dot(observation.features, coefficients)))
      total - (observation.outcome * math.log(probability) +
        (1.0 - observation.outcome) * math.log(1.0 - probability))
    }
    val penalty = 0.5 * l2Penalty * coefficients.map(value => value * value).sum
    val result = loss + penalty
    if result.isFinite then Right(result) else Left(BradleyTerryFailure.NumericalFailure)

  private def metric(
      observations: Vector[PairwiseRankObservation],
      coefficients: Vector[Double],
  )(
      score: (Double, Double) => Double
  ): Either[BradleyTerryFailure, Double] =
    if observations.isEmpty then Left(BradleyTerryFailure.InvalidInput)
    else
      observations.foldLeft[Either[BradleyTerryFailure, Double]](Right(0.0)) {
        case (accumulated, observation) =>
          for
            total <- accumulated
            predicted <- probability(observation.features, coefficients)
          yield total + score(observation.outcome, predicted)
      }.flatMap { total =>
        val result = total / (observations.size * 1.0)
        if result.isFinite then Right(result) else Left(BradleyTerryFailure.NumericalFailure)
      }

  private def validate(
      observations: Vector[PairwiseRankObservation],
      config: BradleyTerryConfig,
  ): Either[BradleyTerryFailure, Int] =
    val dimension = observations.headOption.map(_.features.size).getOrElse(0)
    val validObservations = observations.nonEmpty && dimension > 0 && observations.forall {
      observation =>
        observation.features.size == dimension && observation.features.forall(_.isFinite) &&
        (observation.outcome == 0.0 || observation.outcome == 1.0)
    }
    val validConfig = config.l2Penalty.isFinite && config.l2Penalty > 0.0 &&
      config.maxIterations > 0 && config.tolerance.isFinite && config.tolerance > 0.0 &&
      config.minimumStepScale.isFinite && config.minimumStepScale > 0.0 &&
      config.minimumStepScale <= 1.0
    if validObservations && validConfig then Right(dimension)
    else Left(BradleyTerryFailure.InvalidInput)

  private def observationComesBefore(
      left: PairwiseRankObservation,
      right: PairwiseRankObservation,
  ): Boolean =
    val featureComparison = compareFeatures(left.features, right.features)
    featureComparison < 0 ||
    (featureComparison == 0 && java.lang.Double.compare(left.outcome, right.outcome) < 0)

  private def compareFeatures(left: Vector[Double], right: Vector[Double]): Int =
    @tailrec
    def compareAt(index: Int): Int =
      if index >= left.size then 0
      else
        val comparison = java.lang.Double.compare(left(index), right(index))
        if comparison != 0 then comparison else compareAt(index + 1)

    compareAt(0)

  private def sigmoid(value: Double): Double =
    if value >= 0.0 then
      val exponential = math.exp(-value)
      1.0 / (1.0 + exponential)
    else
      val exponential = math.exp(value)
      exponential / (1.0 + exponential)

  private def clampProbability(value: Double): Double =
    math.max(ProbabilityFloor, math.min(1.0 - ProbabilityFloor, value))

  private def dot(left: Vector[Double], right: Vector[Double]): Double =
    left.zip(right).map { case (a, b) => a * b }.sum

  private def maxAbsolute(values: Vector[Double]): Double =
    values.map(math.abs).maxOption.getOrElse(0.0)
