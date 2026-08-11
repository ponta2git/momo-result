package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.ids.{AccountId, ImageId}
import momo.api.ports.storage.{Sha256Hex, SourceImageObjectKey}
import momo.api.repositories.*

final class PostgresSourceImagesRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends SourceImagesRepository[F]:
  import PostgresSourceImagesRepository.*

  override def reserve(reservation: SourceImageReservation): F[SourceImageReservationResult] =
    val insert = (fr"""
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
    }.transact(transactor)

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

object PostgresSourceImagesRepository:
  private val MaxReconciliationBatchSize = 1000

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

  private val returningAll = fr"""
    RETURNING id, owner_account_id, object_key, idempotency_key_hash, status,
              media_type, byte_length::bigint, sha256_hex, width, height, storage_etag,
              failure_code, available_at, delete_pending_at, deleted_at, created_at, updated_at
  """
