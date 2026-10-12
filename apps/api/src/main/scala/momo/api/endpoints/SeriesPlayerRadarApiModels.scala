package momo.api.endpoints

import java.time.format.DateTimeFormatter

import io.circe.{Codec, Decoder, DecodingFailure, Encoder}
import sttp.tapir.{Schema, Validator}

import momo.api.domain.{SeriesPlayerRadarOperation, SeriesPlayerRadarOperationKind}

final case class SeriesPlayerRadarManualAxisRequest(axisId: String, thresholds: List[Double])
    derives Codec.AsObject
final case class SeriesPlayerRadarManualInputRequest(axes: List[SeriesPlayerRadarManualAxisRequest])
    derives Codec.AsObject

final case class SeriesPlayerRadarOperationRequest(
    gameTitleId: String,
    kind: String,
    candidateId: Option[String],
    previewId: Option[String],
    expectedCurrentBasisId: Option[String],
    originOperationId: Option[String],
    evidenceKey: Option[String],
    expectedCandidateId: Option[String] = None,
    sourceBasisId: Option[String] = None,
    sourceCandidateId: Option[String] = None,
    manualInput: Option[SeriesPlayerRadarManualInputRequest] = None,
)

object SeriesPlayerRadarOperationRequest:
  private val derived = Codec.AsObject.derived[SeriesPlayerRadarOperationRequest]
  given Codec.AsObject[SeriesPlayerRadarOperationRequest] = Codec.AsObject.from(
    Decoder.instance { cursor =>
      derived(cursor).flatMap { request =>
        val fields = cursor.keys.map(_.toSet).getOrElse(Set.empty)
        if request.kind == "manual" &&
          !Set("expectedCurrentBasisId", "expectedCandidateId").subsetOf(fields)
        then
          Left(DecodingFailure(
            "Manual radar saves require explicit expected basis and candidate IDs (or null).",
            cursor.history
          ))
        else Right(request)
      }
    },
    Encoder.AsObject.instance(derived.encodeObject),
  )

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
  given Schema[SeriesPlayerRadarManualAxisRequest] =
    Schema.derived[SeriesPlayerRadarManualAxisRequest]
      .modify(_.axisId)(_.validate(Validator.enumeration(
        List(
          "averageRank",
          "revenueP90",
          "revenueAverage",
          "totalAssetsP10",
          "totalAssetsMedian",
          "totalAssetsP90"
        ),
        value => Some(value)
      )))
  given Schema[SeriesPlayerRadarManualInputRequest] = Schema.derived
  given Schema[SeriesPlayerRadarOperationRequest] = Schema
    .derived[SeriesPlayerRadarOperationRequest].modify(_.kind)(_.validate(kinds))
    .modify(_.originOperationId)(_.description(
      "Required for retry. For withdraw, optionally identifies this actor's manual creation operation; guarded withdrawal refuses any candidate with an accepted apply operation."
    ))
    .modify(_.expectedCurrentBasisId)(_.modifyUnsafe[String](Schema.ModifyCollectionElements)(
      _.nullable
    ))
    .modify(_.expectedCandidateId)(_.modifyUnsafe[String](Schema.ModifyCollectionElements)(
      _.nullable
    ))
    .modify(_.sourceCandidateId)(_.modifyUnsafe[String](Schema.ModifyCollectionElements)(
      _.nullable
    ))
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
