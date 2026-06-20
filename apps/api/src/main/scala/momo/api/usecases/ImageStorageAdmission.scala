package momo.api.usecases

import cats.syntax.all.*
import cats.{Applicative, MonadThrow}
import org.typelevel.log4cats.LoggerFactory

import momo.api.domain.ids.AccountId
import momo.api.errors.AppError
import momo.api.logging.SafeLog
import momo.api.repositories.{ImageDiskUsage, ImageReferenceRepository, ImageStorageInspector}

trait ImageStorageAdmission[F[_]]:
  def ensureCanAccept(ownerAccountId: AccountId, incomingBytes: Long): F[Either[AppError, Unit]]

object ImageStorageAdmission:
  final case class Config(
      unreferencedCountLimit: Int,
      unreferencedBytesLimit: Long,
      storageMinFreeBytes: Long,
      storageMaxUsedPercent: Int,
  )

  enum Rejection derives CanEqual:
    case ReferenceStatusUnavailable(errorClasses: String)
    case UsageStatusUnavailable(errorClasses: String)
    case DiskStatusUnavailable(errorClasses: String)
    case UnreferencedCountExceeded(countAfter: Long, limit: Int)
    case UnreferencedBytesExceeded(bytesAfter: Long, limit: Long)
    case DiskFreeBytesBelowReserve(usableAfter: Long, reserve: Long)
    case DiskUsedPercentExceeded(usedPercentAfter: Long, limit: Int)

    def reason: String = this match
      case ReferenceStatusUnavailable(_) => "reference_status_unavailable"
      case UsageStatusUnavailable(_) => "usage_status_unavailable"
      case DiskStatusUnavailable(_) => "disk_status_unavailable"
      case UnreferencedCountExceeded(_, _) => "unreferenced_count_exceeded"
      case UnreferencedBytesExceeded(_, _) => "unreferenced_bytes_exceeded"
      case DiskFreeBytesBelowReserve(_, _) => "disk_free_bytes_below_reserve"
      case DiskUsedPercentExceeded(_, _) => "disk_used_percent_exceeded"

    def logFields: String = this match
      case ReferenceStatusUnavailable(errorClasses) => s"reason=$reason errorClasses=$errorClasses"
      case UsageStatusUnavailable(errorClasses) => s"reason=$reason errorClasses=$errorClasses"
      case DiskStatusUnavailable(errorClasses) => s"reason=$reason errorClasses=$errorClasses"
      case UnreferencedCountExceeded(countAfter, limit) =>
        s"reason=$reason countAfter=$countAfter limit=$limit"
      case UnreferencedBytesExceeded(bytesAfter, limit) =>
        s"reason=$reason bytesAfter=$bytesAfter limit=$limit"
      case DiskFreeBytesBelowReserve(usableAfter, reserve) =>
        s"reason=$reason usableAfter=$usableAfter reserve=$reserve"
      case DiskUsedPercentExceeded(usedPercentAfter, limit) =>
        s"reason=$reason usedPercentAfter=$usedPercentAfter limit=$limit"

    def error: AppError = this match
      case UnreferencedCountExceeded(_, _) | UnreferencedBytesExceeded(_, _) => AppError
          .TooManyRequests(
            "Too many unprocessed image uploads. Start OCR or wait for old uploads to expire."
          )
      case _ => AppError
          .ServiceUnavailable("Image upload storage is temporarily unavailable. Try again later.")

  def allowAll[F[_]: Applicative]: ImageStorageAdmission[F] = new ImageStorageAdmission[F]:
    override def ensureCanAccept(
        ownerAccountId: AccountId,
        incomingBytes: Long,
    ): F[Either[AppError, Unit]] = Applicative[F].pure(().asRight[AppError])

  def from[F[_]: MonadThrow: LoggerFactory](
      inspector: ImageStorageInspector[F],
      references: ImageReferenceRepository[F],
      config: Config,
  ): ImageStorageAdmission[F] = LiveImageStorageAdmission(inspector, references, config)

private final class LiveImageStorageAdmission[F[_]: MonadThrow: LoggerFactory](
    inspector: ImageStorageInspector[F],
    references: ImageReferenceRepository[F],
    config: ImageStorageAdmission.Config,
) extends ImageStorageAdmission[F]:
  import ImageStorageAdmission.*

  private val logger = LoggerFactory[F].getLoggerFromClass(classOf[LiveImageStorageAdmission[F]])

  override def ensureCanAccept(
      ownerAccountId: AccountId,
      incomingBytes: Long,
  ): F[Either[AppError, Unit]] = references.referencedImageIds.attempt.flatMap {
    case Left(error) =>
      reject(ownerAccountId, Rejection.ReferenceStatusUnavailable(SafeLog.throwableClasses(error)))
    case Right(referenced) => inspector.unreferencedUsage(ownerAccountId, referenced).attempt
        .flatMap {
          case Left(error) => reject(
              ownerAccountId,
              Rejection.UsageStatusUnavailable(SafeLog.throwableClasses(error)),
            )
          case Right(usage) =>
            val countAfter = usage.fileCount.toLong + 1L
            val bytesAfter = saturatedAdd(usage.sizeBytes, incomingBytes)
            if countAfter > config.unreferencedCountLimit.toLong then
              reject(
                ownerAccountId,
                Rejection.UnreferencedCountExceeded(countAfter, config.unreferencedCountLimit),
              )
            else if bytesAfter > config.unreferencedBytesLimit then
              reject(
                ownerAccountId,
                Rejection.UnreferencedBytesExceeded(bytesAfter, config.unreferencedBytesLimit),
              )
            else checkDisk(ownerAccountId, incomingBytes)
        }
  }

  private def checkDisk(ownerAccountId: AccountId, incomingBytes: Long): F[Either[AppError, Unit]] =
    inspector.diskUsage.attempt.flatMap {
      case Left(error) =>
        reject(ownerAccountId, Rejection.DiskStatusUnavailable(SafeLog.throwableClasses(error)))
      case Right(disk) => evaluateDisk(disk, incomingBytes) match
          case Some(rejection) => reject(ownerAccountId, rejection)
          case None => ().asRight[AppError].pure[F]
    }

  private def evaluateDisk(disk: ImageDiskUsage, incomingBytes: Long): Option[Rejection] =
    val usableAfter = saturatedSubtract(disk.usableBytes, incomingBytes)
    if usableAfter < config.storageMinFreeBytes then
      Some(Rejection.DiskFreeBytesBelowReserve(usableAfter, config.storageMinFreeBytes))
    else if disk.totalBytes <= 0L then Some(Rejection.DiskStatusUnavailable("invalid_disk_total"))
    else
      val usedAfter = saturatedAdd(disk.usedBytes, incomingBytes)
      val usedPercentAfter = ceilPercent(usedAfter, disk.totalBytes)
      Option.when(usedPercentAfter > config.storageMaxUsedPercent.toLong)(
        Rejection.DiskUsedPercentExceeded(usedPercentAfter, config.storageMaxUsedPercent)
      )

  private def reject(ownerAccountId: AccountId, rejection: Rejection): F[Either[AppError, Unit]] =
    logger.warn(s"image_upload_admission rejected accountId=${ownerAccountId.value} ${rejection
        .logFields}") >> rejection.error.asLeft[Unit].pure[F]

  private def saturatedAdd(left: Long, right: Long): Long =
    if right > 0L && left > Long.MaxValue - right then Long.MaxValue else left + right

  private def saturatedSubtract(left: Long, right: Long): Long =
    if right > 0L && left < Long.MinValue + right then Long.MinValue else left - right

  private def ceilPercent(value: Long, total: Long): Long =
    val percent = (BigInt(value) * 100 + BigInt(total) - 1) / BigInt(total)
    if percent > BigInt(Long.MaxValue) then Long.MaxValue else percent.toLong
