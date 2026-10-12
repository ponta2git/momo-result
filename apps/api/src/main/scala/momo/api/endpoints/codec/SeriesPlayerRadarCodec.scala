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

  def command(value: SeriesPlayerRadarOperationRequest)
      : Either[AppError, SeriesPlayerRadarCommand] =
    for
      title <- SeriesAnalysisCodec.gameTitleId(value.gameTitleId)
      kind <- SeriesPlayerRadarOperationKind.fromWire(value.kind)
        .toRight(AppError.ValidationFailed("Unknown radar operation kind."))
      candidate <- value.candidateId.traverse(opaqueId("candidateId", _))
      preview <- value.previewId.traverse(opaqueId("previewId", _))
      basis <- value.expectedCurrentBasisId.traverse(opaqueId("expectedCurrentBasisId", _))
      origin <- value.originOperationId.traverse(opaqueId("originOperationId", _))
      evidence <- value.evidenceKey.traverse(opaqueId("evidenceKey", _))
      expectedCandidate <- value.expectedCandidateId.traverse(opaqueId("expectedCandidateId", _))
      sourceBasis <- value.sourceBasisId.traverse(opaqueId("sourceBasisId", _))
      sourceCandidate <- value.sourceCandidateId.traverse(opaqueId("sourceCandidateId", _))
      manual <- value.manualInput.traverse(input =>
        validateManual(SeriesPlayerRadarManualInput(
          input.axes.map(axis =>
            SeriesPlayerRadarManualAxis(
              axis.axisId,
              axis.thresholds.map(value => if value == 0 then 0.0 else value)
            )
          )
        ))
      )
      result = SeriesPlayerRadarCommand(
        title,
        kind,
        candidate,
        preview,
        basis,
        origin,
        evidence,
        expectedCandidate,
        sourceBasis,
        sourceCandidate,
        manual
      )
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
      "expectedCandidateId" -> value.expectedCandidateId,
      "sourceBasisId" -> value.sourceBasisId,
      "sourceCandidateId" -> value.sourceCandidateId,
      "manualInput" -> value.manualInput.map(_ => "manual"),
    ).collect { case (field, Some(_)) => field }.toSet
    val (required, allowed) = value.kind match
      case Candidate => Set.empty[String] -> Set.empty[String]
      case Manual => Set("sourceBasisId", "manualInput") -> Set(
          "sourceBasisId",
          "sourceCandidateId",
          "expectedCandidateId",
          "expectedCurrentBasisId",
          "manualInput"
        )
      case Preview => Set("candidateId") -> Set("candidateId")
      case Apply => Set("candidateId", "previewId") ->
          Set("candidateId", "previewId", "expectedCurrentBasisId")
      case Withdraw => Set("candidateId") -> Set("candidateId", "originOperationId")
      case Restore => Set.empty[String] -> Set("expectedCurrentBasisId")
      case Acknowledge => Set("evidenceKey") -> Set("evidenceKey")
      case Retry => Set("originOperationId") -> Set("originOperationId")
    Either.cond(
      required.subsetOf(supplied) && supplied.subsetOf(allowed),
      (),
      AppError.ValidationFailed(s"Invalid fields for radar ${value.kind.wire} operation."),
    )

  private val axisIds = List(
    "averageRank",
    "revenueP90",
    "revenueAverage",
    "totalAssetsP10",
    "totalAssetsMedian",
    "totalAssetsP90"
  )

  private def validateManual(value: SeriesPlayerRadarManualInput)
      : Either[AppError, SeriesPlayerRadarManualInput] =
    val valid = value.axes.map(_.axisId) == axisIds && value.axes.forall { axis =>
      val bounds = axis.thresholds
      bounds.size == 9 && bounds.forall(_.isFinite) &&
      bounds.sliding(2).forall {
        case List(left, right) =>
          if axis.axisId == "averageRank" then left > right else left < right
        case _ => true
      } && (axis.axisId != "averageRank" || bounds.lastOption.exists(_ >= 1))
    }
    Either.cond(
      valid,
      value,
      AppError.ValidationFailed(
        "Manual radar boundaries require the six axes in order, nine finite strictly ordered values per axis, and an average-rank 10-point boundary of at least 1."
      )
    )
