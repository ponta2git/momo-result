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

object OcrJob:
  def detectedScreenType(job: OcrJob): Option[ScreenType] = job match
    case _: Queued => None
    case _: Running => None
    case value: Succeeded => Some(value.succeededDetectedScreenType)
    case value: Failed => value.failedDetectedScreenType
    case _: Cancelled => None

  def workerId(job: OcrJob): Option[String] = job match
    case _: Queued => None
    case value: Running => Some(value.runningWorkerId)
    case value: Succeeded => value.succeededWorkerId
    case value: Failed => value.failedWorkerId
    case _: Cancelled => None

  def failure(job: OcrJob): Option[OcrFailure] = job match
    case value: Failed => Some(value.failedFailure)
    case _ => None

  def startedAt(job: OcrJob): Option[Instant] = job match
    case _: Queued => None
    case value: Running => Some(value.runningStartedAt)
    case value: Succeeded => Some(value.succeededStartedAt)
    case value: Failed => value.failedStartedAt
    case _: Cancelled => None

  def finishedAt(job: OcrJob): Option[Instant] = job match
    case _: Queued => None
    case _: Running => None
    case value: Succeeded => Some(value.succeededFinishedAt)
    case value: Failed => Some(value.failedFinishedAt)
    case value: Cancelled => Some(value.cancelledFinishedAt)

  def durationMs(job: OcrJob): Option[Int] = job match
    case value: Succeeded => Some(value.succeededDurationMs)
    case value: Failed => value.failedDurationMs
    case _ => None

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

end OcrJob
