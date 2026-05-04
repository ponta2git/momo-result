package momo.api.domain

import java.nio.file.Path
import java.time.Instant

import momo.api.domain.ids.*

enum OcrJobStatus(val wire: String) derives CanEqual:
  case Queued extends OcrJobStatus("queued")
  case Running extends OcrJobStatus("running")
  case Succeeded extends OcrJobStatus("succeeded")
  case Failed extends OcrJobStatus("failed")
  case Cancelled extends OcrJobStatus("cancelled")

final case class OcrFailure(
    code: FailureCode,
    message: String,
    retryable: Boolean,
    userAction: Option[String],
)

/**
 * Lifecycle of an OCR job, modelled as a sealed ADT so that unrepresentable states (e.g. a
 * `Succeeded` job without `finishedAt` or a `Queued` job with a `failure`) are eliminated at the
 * type level.
 *
 * The trait exposes Option-typed accessors for fields that vary across cases so that read-only
 * call sites (DTO mappers, repository SQL writers) keep working unchanged. Mutation/transition
 * sites construct the appropriate case class directly.
 *
 * Mapping to/from `ocr_jobs` rows lives in [[momo.api.repositories.postgres.PostgresOcrJobsRepository]]:
 * `toJob` dispatches on the `status` column, and the SQL writer reads through the trait accessors.
 */
sealed trait OcrJob derives CanEqual:
  def id: OcrJobId
  def draftId: OcrDraftId
  def imageId: ImageId
  def imagePath: Path
  def requestedScreenType: ScreenType
  def status: OcrJobStatus
  def attemptCount: Int
  def createdAt: Instant
  def updatedAt: Instant
  def detectedScreenType: Option[ScreenType] = None
  def workerId: Option[String] = None
  def failure: Option[OcrFailure] = None
  def startedAt: Option[Instant] = None
  def finishedAt: Option[Instant] = None
  def durationMs: Option[Int] = None

object OcrJob:

  /** Newly created job sitting in the queue, awaiting a worker to claim it. */
  final case class Queued(
      id: OcrJobId,
      draftId: OcrDraftId,
      imageId: ImageId,
      imagePath: Path,
      requestedScreenType: ScreenType,
      attemptCount: Int,
      createdAt: Instant,
      updatedAt: Instant,
  ) extends OcrJob:
    val status: OcrJobStatus = OcrJobStatus.Queued

  /** Job that has been claimed by a worker and is in flight. */
  final case class Running(
      id: OcrJobId,
      draftId: OcrDraftId,
      imageId: ImageId,
      imagePath: Path,
      requestedScreenType: ScreenType,
      attemptCount: Int,
      runningWorkerId: String,
      runningStartedAt: Instant,
      createdAt: Instant,
      updatedAt: Instant,
  ) extends OcrJob:
    val status: OcrJobStatus = OcrJobStatus.Running
    override def workerId: Option[String] = Some(runningWorkerId)
    override def startedAt: Option[Instant] = Some(runningStartedAt)

  /** Successfully completed job. The detected screen type is authoritative. */
  final case class Succeeded(
      id: OcrJobId,
      draftId: OcrDraftId,
      imageId: ImageId,
      imagePath: Path,
      requestedScreenType: ScreenType,
      succeededDetectedScreenType: ScreenType,
      attemptCount: Int,
      succeededWorkerId: Option[String],
      succeededStartedAt: Instant,
      succeededFinishedAt: Instant,
      succeededDurationMs: Int,
      createdAt: Instant,
      updatedAt: Instant,
  ) extends OcrJob:
    val status: OcrJobStatus = OcrJobStatus.Succeeded
    override def detectedScreenType: Option[ScreenType] = Some(succeededDetectedScreenType)
    override def workerId: Option[String] = succeededWorkerId
    override def startedAt: Option[Instant] = Some(succeededStartedAt)
    override def finishedAt: Option[Instant] = Some(succeededFinishedAt)
    override def durationMs: Option[Int] = Some(succeededDurationMs)

  /** Job that has terminated with a failure. Always has [[OcrFailure]] populated. */
  final case class Failed(
      id: OcrJobId,
      draftId: OcrDraftId,
      imageId: ImageId,
      imagePath: Path,
      requestedScreenType: ScreenType,
      failedDetectedScreenType: Option[ScreenType],
      attemptCount: Int,
      failedWorkerId: Option[String],
      failedFailure: OcrFailure,
      failedStartedAt: Option[Instant],
      failedFinishedAt: Instant,
      failedDurationMs: Option[Int],
      createdAt: Instant,
      updatedAt: Instant,
  ) extends OcrJob:
    val status: OcrJobStatus = OcrJobStatus.Failed
    override def detectedScreenType: Option[ScreenType] = failedDetectedScreenType
    override def workerId: Option[String] = failedWorkerId
    override def failure: Option[OcrFailure] = Some(failedFailure)
    override def startedAt: Option[Instant] = failedStartedAt
    override def finishedAt: Option[Instant] = Some(failedFinishedAt)
    override def durationMs: Option[Int] = failedDurationMs

  /** Cancelled job (only Queued jobs may transition here in current MVP). */
  final case class Cancelled(
      id: OcrJobId,
      draftId: OcrDraftId,
      imageId: ImageId,
      imagePath: Path,
      requestedScreenType: ScreenType,
      attemptCount: Int,
      cancelledFinishedAt: Instant,
      createdAt: Instant,
      updatedAt: Instant,
  ) extends OcrJob:
    val status: OcrJobStatus = OcrJobStatus.Cancelled
    override def finishedAt: Option[Instant] = Some(cancelledFinishedAt)

end OcrJob
