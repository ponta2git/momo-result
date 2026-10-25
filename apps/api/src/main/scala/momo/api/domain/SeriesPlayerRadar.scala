package momo.api.domain

import java.time.Instant

import cats.syntax.all.*

import momo.api.domain.ids.GameTitleId
import momo.api.errors.AppError

enum SeriesPlayerRadarOperationKind(val wire: String) derives CanEqual:
  case Candidate extends SeriesPlayerRadarOperationKind("candidate")
  case Manual extends SeriesPlayerRadarOperationKind("manual")
  case Preview extends SeriesPlayerRadarOperationKind("preview")
  case Apply extends SeriesPlayerRadarOperationKind("apply")
  case Withdraw extends SeriesPlayerRadarOperationKind("withdraw")
  case Restore extends SeriesPlayerRadarOperationKind("restore")
  case Acknowledge extends SeriesPlayerRadarOperationKind("acknowledge")
  case Retry extends SeriesPlayerRadarOperationKind("retry")

object SeriesPlayerRadarOperationKind:
  def fromWire(value: String): Option[SeriesPlayerRadarOperationKind] = values.find(_.wire == value)

final case class SeriesPlayerRadarManualAxis(axisId: String, thresholds: List[Double])
final case class SeriesPlayerRadarAchievementCurve(pointThresholds: List[Double]):
  def valid: Boolean = pointThresholds.size == 9 &&
    pointThresholds.forall(value => value.isFinite && value >= 0 && value <= 102400) &&
    pointThresholds.sliding(2).forall {
      case List(left, right) => left < right
      case _ => true
    }

object SeriesPlayerRadarAchievementCurve:
  val Default =
    SeriesPlayerRadarAchievementCurve(List(5.0, 10.0, 20.0, 30.0, 50.0, 75.0, 100.0, 150.0, 200.0))

final case class SeriesPlayerRadarManualInput(
    axes: List[SeriesPlayerRadarManualAxis],
    achievementCurve: Option[SeriesPlayerRadarAchievementCurve] = None,
):
  def validated: Either[AppError, SeriesPlayerRadarManualInput] =
    SeriesPlayerRadarCommand.validateManual(this)

/** Calculated scores are never accepted; manual commands contain only proposed boundaries. */
final case class SeriesPlayerRadarCommand(
    gameTitleId: GameTitleId,
    kind: SeriesPlayerRadarOperationKind,
    candidateId: Option[String],
    previewId: Option[String],
    expectedCurrentBasisId: Option[String],
    originOperationId: Option[String],
    evidenceKey: Option[String],
    expectedCandidateId: Option[String] = None,
    sourceBasisId: Option[String] = None,
    sourceCandidateId: Option[String] = None,
    manualInput: Option[SeriesPlayerRadarManualInput] = None,
):
  /** Validates new commands; persistence may restore historical commands separately. */
  def validated: Either[AppError, SeriesPlayerRadarCommand] =
    for
      normalized <- manualInput.traverse(_.validated)
      command = copy(manualInput = normalized)
      _ <- SeriesPlayerRadarCommand.validateFields(command)
    yield command

object SeriesPlayerRadarCommand:
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

  private[domain] def validateManual(value: SeriesPlayerRadarManualInput)
      : Either[AppError, SeriesPlayerRadarManualInput] =
    val valid = value.achievementCurve.forall(_.valid) && value.axes.map(_.axisId) == axisIds &&
      value.axes.forall { axis =>
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
      value.copy(
        achievementCurve = value.achievementCurve.map(curve =>
          curve.copy(pointThresholds =
            curve.pointThresholds.map(bound => if bound == 0 then 0.0 else bound)
          )
        ),
        axes =
          value.axes.map(axis =>
            axis.copy(thresholds = axis.thresholds.map(bound => if bound == 0 then 0.0 else bound))
          )
      ),
      AppError.ValidationFailed(
        "Manual radar boundaries require the six axes in order, nine finite strictly ordered values per axis, and an average-rank 10-point boundary of at least 1. Achievement points require nine finite, strictly increasing values between 0 and 102400."
      )
    )

final case class SeriesPlayerRadarHistoryRequest(
    gameTitleId: Option[GameTitleId],
    limit: Int,
    cursor: Option[String],
)

final case class SeriesPlayerRadarOperation(
    operationId: String,
    gameTitleId: GameTitleId,
    kind: String,
    status: String,
    candidateId: Option[String],
    previewId: Option[String],
    basisId: Option[String],
    originOperationId: Option[String],
    safeFailureCode: Option[String],
    requestedAt: Instant,
    finishedAt: Option[Instant],
)

final case class SeriesPlayerRadarPreviewRequest(
    gameTitleId: GameTitleId,
    previewId: String,
    scope: SeriesAnalysisScope,
)

/** API projection of validated Worker-owned JSON. It contains no private calculation snapshot. */
final case class SeriesPlayerRadarDocument(payload: Array[Byte])
