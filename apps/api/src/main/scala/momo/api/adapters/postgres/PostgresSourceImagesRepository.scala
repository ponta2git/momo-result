package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.ids.{AccountId, ImageId}
import momo.api.ports.storage.{
  ImageStorageUsage,
  Sha256Hex,
  SourceImageIdempotencyHash,
  SourceImageObjectKey
}
import momo.api.repositories.*

final class PostgresSourceImagesRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends SourceImagesRepository[F]:
  import PostgresSourceImagesRepository.*

  override def reserve(reservation: SourceImageReservation): F[SourceImageReservationResult] =
    val insert =
      (fr"""
      INSERT INTO source_images (
        id, owner_account_id, object_key, idempotency_key_hash, status,
        media_type, byte_length, sha256_hex, width, height, created_at, updated_at
      ) VALUES (
        ${reservation.id}, ${reservation.ownerAccountId}, ${reservation.objectKey},
        ${reservation.idempotencyKeyHash}, ${SourceImageStatus.Reserved},
        ${reservation.mediaType}, ${reservation.sizeBytes}, ${reservation.sha256},
        ${reservation.width}, ${reservation.height}, ${reservation.now}, ${reservation.now}
      )
      ON CONFLICT (owner_account_id, idempotency_key_hash) DO NOTHING
    """ ++ returningAll).query[Row].option
    val existing = (selectAll ++ fr"""
      WHERE owner_account_id = ${reservation.ownerAccountId}
        AND idempotency_key_hash = ${reservation.idempotencyKeyHash}
    """).query[Row].unique

    insert.flatMap {
      case Some(row) => SourceImageReservationResult.Reserved(row.toRecord).pure[ConnectionIO]
      case None => existing.map(row => SourceImageReservationResult.Existing(row.toRecord))
    }.transact(transactor)

  override def find(id: ImageId): F[Option[SourceImageRecord]] = (selectAll ++ fr"WHERE id = $id")
    .query[Row].option.map(_.map(_.toRecord)).transact(transactor)

  override def markAvailable(
      id: ImageId,
      storageEtag: Option[String],
      now: Instant,
  ): F[Boolean] = sql"""
      UPDATE source_images
      SET status = ${SourceImageStatus.Available}, storage_etag = $storageEtag,
          failure_code = NULL, available_at = $now, updated_at = $now
      WHERE id = $id AND status = ${SourceImageStatus.Reserved}
    """.update.run.map(_ == 1).transact(transactor)

  override def markUploadFailed(
      id: ImageId,
      failureCode: SourceImageFailureCode,
      now: Instant,
  ): F[Boolean] = sql"""
      UPDATE source_images
      SET status = ${SourceImageStatus.Failed}, failure_code = $failureCode, updated_at = $now
      WHERE id = $id AND status = ${SourceImageStatus.Reserved}
    """.update.run.map(_ == 1).transact(transactor)

  override def retryFailed(id: ImageId, now: Instant): F[Boolean] = sql"""
      UPDATE source_images
      SET status = ${SourceImageStatus.Reserved}, failure_code = NULL, updated_at = $now
      WHERE id = $id AND status = ${SourceImageStatus.Failed}
    """.update.run.map(_ == 1).transact(transactor)

  override def beginDelete(id: ImageId, now: Instant): F[SourceImageDeleteResult] =
    val update = (fr"""
      UPDATE source_images
      SET status = ${SourceImageStatus.DeletePending}, delete_pending_at = $now, updated_at = $now
      WHERE id = $id AND status = ${SourceImageStatus.Available}
    """ ++ returningAll).query[Row].option
    beginDeleteResult(update, id).transact(transactor)

  override def beginDeleteUnreferenced(
      id: ImageId,
      now: Instant,
  ): F[SourceImageDeleteResult] =
    val update = (fr"""
      UPDATE source_images AS candidate
      SET status = ${SourceImageStatus.DeletePending}, delete_pending_at = $now, updated_at = $now
      WHERE candidate.id = $id AND candidate.status = ${SourceImageStatus.Available}
    """ ++ unreferencedGuard ++ returningAll).query[Row].option
    beginDeleteResult(update, id).transact(transactor)

  private def beginDeleteResult(
      update: ConnectionIO[Option[Row]],
      id: ImageId,
  ): ConnectionIO[SourceImageDeleteResult] =
    val current = (selectAll ++ fr"WHERE id = $id").query[Row].option
    update.flatMap {
      case Some(row) => SourceImageDeleteResult.Pending(row.toRecord).pure[ConnectionIO]
      case None => current.map {
          case None => SourceImageDeleteResult.Missing
          case Some(row) if row.status == SourceImageStatus.DeletePending =>
            SourceImageDeleteResult.Pending(row.toRecord)
          case Some(row) if row.status == SourceImageStatus.Deleted =>
            SourceImageDeleteResult.AlreadyDeleted
          case Some(row) => SourceImageDeleteResult.NotReady(row.status)
        }
    }

  override def markDeleted(id: ImageId, now: Instant): F[Boolean] = sql"""
      UPDATE source_images
      SET status = ${SourceImageStatus.Deleted}, deleted_at = $now, updated_at = $now
      WHERE id = $id AND status = ${SourceImageStatus.DeletePending}
    """.update.run.map(_ == 1).transact(transactor)

  override def reconciliationCandidates(
      olderThan: Instant,
      limit: Int,
  ): F[List[SourceImageRecord]] =
    val boundedLimit = limit.max(1).min(MaxReconciliationBatchSize)
    (selectAll ++ fr"""
      WHERE status IN (
        ${SourceImageStatus.Reserved}, ${SourceImageStatus.Failed},
        ${SourceImageStatus.DeletePending}
      )
        AND updated_at <= $olderThan
      ORDER BY updated_at, id
      LIMIT $boundedLimit
    """).query[Row].to[List].map(_.map(_.toRecord)).transact(transactor)

  override def orphanCandidates(
      olderThan: Instant,
      limit: Int,
  ): F[List[SourceImageRecord]] =
    val boundedLimit = limit.max(1).min(MaxReconciliationBatchSize)
    (selectAllAliased ++ fr"""
      WHERE candidate.status = ${SourceImageStatus.Available}
        AND candidate.available_at <= $olderThan
    """ ++ unreferencedGuard ++ fr"""
      ORDER BY candidate.available_at, candidate.id
      LIMIT $boundedLimit
    """).query[Row].to[List].map(_.map(_.toRecord)).transact(transactor)

  override def purgeFailed(id: ImageId, olderThan: Instant): F[Boolean] = (fr"""
      DELETE FROM source_images AS candidate
      WHERE candidate.id = $id
        AND candidate.status = ${SourceImageStatus.Failed}
        AND candidate.updated_at <= $olderThan
    """ ++ unreferencedGuard).update.run.map(_ == 1).transact(transactor)

  override def unreferencedUsage(ownerAccountId: AccountId): F[ImageStorageUsage] = (fr"""
      SELECT COUNT(*)::bigint, COALESCE(SUM(candidate.byte_length), 0)::bigint
      FROM source_images AS candidate
      WHERE candidate.owner_account_id = $ownerAccountId
        AND candidate.status <> ${SourceImageStatus.Deleted}
    """ ++ unreferencedGuard).query[UsageRow].unique.map { row =>
    ImageStorageUsage(Math.toIntExact(row.fileCount), row.sizeBytes)
  }.transact(transactor)

object PostgresSourceImagesRepository:
  private val MaxReconciliationBatchSize = 1000

  private final case class UsageRow(fileCount: Long, sizeBytes: Long)

  private final case class Row(
      id: ImageId,
      ownerAccountId: AccountId,
      objectKey: SourceImageObjectKey,
      idempotencyKeyHash: SourceImageIdempotencyHash,
      status: SourceImageStatus,
      mediaType: Option[String],
      byteLength: Option[Long],
      sha256: Option[Sha256Hex],
      width: Option[Int],
      height: Option[Int],
      storageEtag: Option[String],
      failureCode: Option[SourceImageFailureCode],
      availableAt: Option[Instant],
      deletePendingAt: Option[Instant],
      deletedAt: Option[Instant],
      createdAt: Instant,
      updatedAt: Instant,
  ):
    def toRecord: SourceImageRecord = SourceImageRecord(
      id,
      ownerAccountId,
      objectKey,
      idempotencyKeyHash,
      status,
      mediaType,
      byteLength,
      sha256,
      width,
      height,
      storageEtag,
      failureCode,
      availableAt,
      deletePendingAt,
      deletedAt,
      createdAt,
      updatedAt,
    )

  private val selectAll = fr"""
    SELECT id, owner_account_id, object_key, idempotency_key_hash, status,
           media_type, byte_length::bigint, sha256_hex, width, height, storage_etag,
           failure_code, available_at, delete_pending_at, deleted_at, created_at, updated_at
    FROM source_images
  """

  private val selectAllAliased = fr"""
    SELECT candidate.id, candidate.owner_account_id, candidate.object_key,
           candidate.idempotency_key_hash, candidate.status, candidate.media_type,
           candidate.byte_length::bigint, candidate.sha256_hex, candidate.width,
           candidate.height, candidate.storage_etag, candidate.failure_code,
           candidate.available_at, candidate.delete_pending_at, candidate.deleted_at,
           candidate.created_at, candidate.updated_at
    FROM source_images AS candidate
  """

  private val unreferencedGuard = fr"""
    AND NOT EXISTS (
      SELECT 1
      FROM ocr_jobs
      WHERE ocr_jobs.source_image_id = candidate.id OR ocr_jobs.image_id = candidate.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM match_drafts
      WHERE match_drafts.source_images_deleted_at IS NULL
        AND (
          match_drafts.total_assets_image_id = candidate.id OR
          match_drafts.revenue_image_id = candidate.id OR
          match_drafts.incident_log_image_id = candidate.id
        )
    )
  """

  private val returningAll = fr"""
    RETURNING id, owner_account_id, object_key, idempotency_key_hash, status,
              media_type, byte_length::bigint, sha256_hex, width, height, storage_etag,
              failure_code, available_at, delete_pending_at, deleted_at, created_at, updated_at
  """
