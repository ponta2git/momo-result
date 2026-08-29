package momo.api.endpoints

import sttp.tapir.{Schema, Validator}

import momo.api.domain.SeriesAnalysisVocabulary

object SeriesAnalysisApiSchemas:
  private def required[A](schema: Schema[A]): Schema[A] = schema.copy(isOptional = false)
  private def requiredNullable[A](schema: Schema[Option[A]]): Schema[Option[A]] =
    // Tapir drops usage-site nullability from named Option references. These one-use envelope
    // values stay inline so the component itself does not incorrectly become nullable.
    required(schema).modifyUnsafe[A](Schema.ModifyCollectionElements)(nested =>
      nested.copy(name = None).nullable
    )

  private def closedString(values: List[String]): Validator[String] =
    Validator.enumeration(values, value => Some(value))

  private def closedNullableString(values: List[String]): Validator[Option[String]] =
    Validator.enumeration(
      None :: values.map(Some(_)),
      value => Some(value.orNull),
    )

  private val EnvelopeSchemaVersion = Validator.enumeration(
    List(SeriesAnalysisVocabulary.EnvelopeSchemaVersion),
    value => Some(value),
  )

  given Schema[SeriesAnalysisDesiredResponse] = Schema.derived
  given Schema[SeriesAnalysisArtifactRefResponse] = Schema.derived
  given Schema[SeriesAnalysisCalculationResponse] = Schema
    .derived[SeriesAnalysisCalculationResponse]
    .modify(_.status)(_.validate(closedString(SeriesAnalysisVocabulary.JobStatuses)))
    .modify(_.trigger)(
      _.validate(closedString(SeriesAnalysisVocabulary.TriggersByPriority))
    )
    .modify(_.startedAt)(requiredNullable)
    .modify(_.finishedAt)(requiredNullable)
  given Schema[SeriesAnalysisStatusResponse] = Schema
    .derived[SeriesAnalysisStatusResponse]
    .modify(_.schemaVersion)(_.validate(EnvelopeSchemaVersion))
    .modify(_.artifactFreshness)(
      _.validate(closedString(SeriesAnalysisVocabulary.ArtifactFreshness))
    )
    .modify(_.currentArtifact)(requiredNullable)
    .modify(_.calculation)(requiredNullable)
  given Schema[SeriesAnalysisSeasonOptionResponse] = Schema.derived
  given Schema[SeriesAnalysisMapOptionResponse] = Schema.derived
  given Schema[SeriesAnalysisSeasonMapPairResponse] = Schema.derived
  given Schema[SeriesAnalysisTitleOptionResponse] = Schema
    .derived[SeriesAnalysisTitleOptionResponse]
    .modify(_.seasons)(required)
    .modify(_.maps)(required)
    .modify(_.seasonMapPairs)(required)
  given Schema[SeriesAnalysisOptionsResponse] = Schema
    .derived[SeriesAnalysisOptionsResponse]
    .modify(_.schemaVersion)(_.validate(EnvelopeSchemaVersion))
    .modify(_.defaultGameTitleId)(requiredNullable)
    .modify(_.titles)(required)
  given Schema[SeriesAnalysisRecalculationRequest] = Schema.derived
  given Schema[SeriesAnalysisAllRecalculationRequest] = Schema.derived
  given Schema[SeriesAnalysisAcceptedCampaignResponse] = Schema
    .derived[SeriesAnalysisAcceptedCampaignResponse]
    .modify(_.status)(
      _.validate(closedString(SeriesAnalysisVocabulary.AcceptedCampaignStatuses))
    )
  given Schema[SeriesAnalysisAcceptedTargetResponse] = Schema
    .derived[SeriesAnalysisAcceptedTargetResponse]
    .modify(_.jobId)(requiredNullable)
    .modify(_.requestDisposition)(
      _.validate(closedString(SeriesAnalysisVocabulary.RequestDispositions))
    )
  given Schema[SeriesAnalysisRecalculationAcceptedResponse] = Schema
    .derived[SeriesAnalysisRecalculationAcceptedResponse]
    .modify(_.schemaVersion)(_.validate(EnvelopeSchemaVersion))
    .modify(_.campaign)(requiredNullable)
    .modify(_.target)(requiredNullable)
  given Schema[SeriesAnalysisAdminTitleOptionResponse] = Schema.derived
  given Schema[SeriesAnalysisPendingManualRunResponse] = Schema.derived
  given Schema[SeriesAnalysisSelectedTitleResponse] = Schema
    .derived[SeriesAnalysisSelectedTitleResponse]
    .modify(_.pendingManualRun)(requiredNullable)
  given Schema[SeriesAnalysisCampaignSummaryResponse] = Schema.derived
  given Schema[SeriesAnalysisGlobalExecutionResponse] = Schema
    .derived[SeriesAnalysisGlobalExecutionResponse]
    .modify(_.oldestQueuedAt)(requiredNullable)
    .modify(_.latestActiveCampaign)(requiredNullable)
  given Schema[SeriesAnalysisRequesterResponse] = Schema.derived
  given Schema[SeriesAnalysisJobSummaryResponse] = Schema
    .derived[SeriesAnalysisJobSummaryResponse]
    .modify(_.status)(_.validate(closedString(SeriesAnalysisVocabulary.JobStatuses)))
    .modify(_.trigger)(
      _.validate(closedString(SeriesAnalysisVocabulary.TriggersByPriority))
    )
    .modify(_.coalescedTriggers)(required)
    .modifyUnsafe[String]("coalescedTriggers", Schema.ModifyCollectionElements)(
      _.validate(closedString(SeriesAnalysisVocabulary.TriggersByPriority))
    )
    .modify(_.requestedBy)(_.validate(closedString(SeriesAnalysisVocabulary.RequestedBy)))
    .modify(_.startedAt)(requiredNullable)
    .modify(_.finishedAt)(requiredNullable)
    .modify(_.elapsedMilliseconds)(requiredNullable)
    .modify(_.queueWaitMilliseconds)(requiredNullable)
    .modify(_.resultDisposition)(
      _.validate(closedString(SeriesAnalysisVocabulary.ResultDispositions))
    )
    .modify(_.firstManualRequester)(requiredNullable)
    .modify(_.safeFailureCode)(schema =>
      requiredNullable(schema).validate(
        closedNullableString(SeriesAnalysisVocabulary.SafeFailureCodes)
      )
    )
  given Schema[SeriesAnalysisAdminOverviewResponse] = Schema
    .derived[SeriesAnalysisAdminOverviewResponse]
    .modify(_.schemaVersion)(_.validate(EnvelopeSchemaVersion))
    .modify(_.titleOptions)(required)
    .modify(_.selectedTitle)(requiredNullable)
    .modify(_.recentJobs)(required)
