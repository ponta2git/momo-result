package momo.api.endpoints.codec

import cats.syntax.all.*

import momo.api.domain.*
import momo.api.endpoints.SeriesPlayerRadarOperationRequest
import momo.api.errors.AppError

object SeriesPlayerRadarCodec:
  def opaqueId(field: String, value: String): Either[AppError, String] = BoundaryId
    .nonBlank(field, value).flatMap(id =>
      Either.cond(
        id.matches("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"),
        id,
        AppError.ValidationFailed(s"$field is invalid."),
      )
    )

  def command(value: SeriesPlayerRadarOperationRequest): Either[AppError, SeriesPlayerRadarCommand] =
    for
      title <- SeriesAnalysisCodec.gameTitleId(value.gameTitleId)
      kind <- SeriesPlayerRadarOperationKind.fromWire(value.kind)
        .toRight(AppError.ValidationFailed("Unknown radar operation kind."))
      candidate <- value.candidateId.traverse(opaqueId("candidateId", _))
      preview <- value.previewId.traverse(opaqueId("previewId", _))
      basis <- value.expectedCurrentBasisId.traverse(opaqueId("expectedCurrentBasisId", _))
      origin <- value.originOperationId.traverse(opaqueId("originOperationId", _))
      evidence <- value.evidenceKey.traverse(opaqueId("evidenceKey", _))
      result = SeriesPlayerRadarCommand(title, kind, candidate, preview, basis, origin, evidence)
      _ <- validateFields(result)
    yield result

  private def validateFields(value: SeriesPlayerRadarCommand): Either[AppError, Unit] =
    import SeriesPlayerRadarOperationKind.*
    val supplied = List(
      "candidateId" -> value.candidateId,
      "previewId" -> value.previewId,
      "expectedCurrentBasisId" -> value.expectedCurrentBasisId,
      "originOperationId" -> value.originOperationId,
      "evidenceKey" -> value.evidenceKey,
    ).collect { case (field, Some(_)) => field }.toSet
    val (required, allowed) = value.kind match
      case Candidate => Set.empty[String] -> Set.empty[String]
      case Preview => Set("candidateId") -> Set("candidateId")
      case Apply => Set("candidateId", "previewId") ->
          Set("candidateId", "previewId", "expectedCurrentBasisId")
      case Withdraw => Set("candidateId") -> Set("candidateId")
      case Restore => Set.empty[String] -> Set("expectedCurrentBasisId")
      case Acknowledge => Set("evidenceKey") -> Set("evidenceKey")
      case Retry => Set("originOperationId") -> Set("originOperationId")
    Either.cond(
      required.subsetOf(supplied) && supplied.subsetOf(allowed),
      (),
      AppError.ValidationFailed(s"Invalid fields for radar ${value.kind.wire} operation."),
    )
