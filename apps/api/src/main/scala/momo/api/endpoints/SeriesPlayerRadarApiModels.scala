package momo.api.endpoints

import java.time.format.DateTimeFormatter

import io.circe.Codec
import sttp.tapir.{Schema, Validator}

import momo.api.domain.{SeriesPlayerRadarOperation, SeriesPlayerRadarOperationKind}

final case class SeriesPlayerRadarOperationRequest(
    gameTitleId: String,
    kind: String,
    candidateId: Option[String],
    previewId: Option[String],
    expectedCurrentBasisId: Option[String],
    originOperationId: Option[String],
    evidenceKey: Option[String],
) derives Codec.AsObject

final case class SeriesPlayerRadarOperationResponse(
    schemaVersion: Int,
    operationId: String,
    gameTitleId: String,
    kind: String,
    status: String,
    candidateId: Option[String],
    previewId: Option[String],
    basisId: Option[String],
    originOperationId: Option[String],
    safeFailureCode: Option[String],
    requestedAt: String,
    finishedAt: Option[String],
) derives Codec.AsObject

object SeriesPlayerRadarOperationResponse:
  def from(value: SeriesPlayerRadarOperation): SeriesPlayerRadarOperationResponse =
    SeriesPlayerRadarOperationResponse(
      1,
      value.operationId,
      value.gameTitleId.value,
      value.kind,
      value.status,
      value.candidateId,
      value.previewId,
      value.basisId,
      value.originOperationId,
      value.safeFailureCode,
      DateTimeFormatter.ISO_INSTANT.format(value.requestedAt),
      value.finishedAt.map(DateTimeFormatter.ISO_INSTANT.format),
    )

object SeriesPlayerRadarApiSchemas:
  private def requiredNullable[A](schema: Schema[Option[A]]): Schema[Option[A]] =
    schema.copy(isOptional = false).modifyUnsafe[A](Schema.ModifyCollectionElements)(nested =>
      nested.copy(name = None).nullable
    )

  private val kinds = Validator.enumeration(
    SeriesPlayerRadarOperationKind.values.toList.map(_.wire),
    value => Some(value),
  )
  private val statuses = Validator.enumeration(
    List("pending", "running", "succeeded", "failed", "withdrawn"),
    value => Some(value),
  )
  given Schema[SeriesPlayerRadarOperationRequest] = Schema
    .derived[SeriesPlayerRadarOperationRequest].modify(_.kind)(_.validate(kinds))
  given Schema[SeriesPlayerRadarOperationResponse] = Schema
    .derived[SeriesPlayerRadarOperationResponse]
    .modify(_.schemaVersion)(_.validate(Validator.enumeration(List(1), value => Some(value))))
    .modify(_.kind)(_.validate(kinds))
    .modify(_.status)(_.validate(statuses))
    .modify(_.candidateId)(requiredNullable)
    .modify(_.previewId)(requiredNullable)
    .modify(_.basisId)(requiredNullable)
    .modify(_.originOperationId)(requiredNullable)
    .modify(_.safeFailureCode)(requiredNullable)
    .modify(_.finishedAt)(requiredNullable)
