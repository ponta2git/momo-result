package momo.api.domain

import java.time.Instant

import momo.api.domain.ids.GameTitleId

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
final case class SeriesPlayerRadarManualInput(axes: List[SeriesPlayerRadarManualAxis])

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
