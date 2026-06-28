package momo.api.usecases.seriescomparison

private[seriescomparison] object SeriesComparisonReviewThresholds:
  val MainNormalSample = 20
  val MainConditionalSample = 8
  val ReferenceSample = 3
  val PriorWeight = 8.0
  val SignificantScoreDelta = 0.35
  val MinimumContrast = 0.14
  val MinimumActionDriverEffect = 0.30
  val ReferenceActionDriverEffect = 0.50
  val ActionDriverTieDelta = 0.08
  val RecoverySignificantRateDelta = 0.05
  val RecoveryMinimumDriverContrast = 0.30
  val BootstrapIterations = 96
  val CommonTopicPlayerCount = 3
  val CommonTopicLimit = 2
