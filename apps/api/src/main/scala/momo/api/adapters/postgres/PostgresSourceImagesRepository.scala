package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.{MatchDraftStatus, OcrJobStatus}
import momo.api.domain.ids.{AccountId, ImageId}
import momo.api.ports.storage.{Sha256Hex, SourceImageIdempotencyHash, SourceImageObjectKey}
import momo.api.repositories.*

final class PostgresSourceImagesRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends SourceImagesRepository[F]:
  import PostgresSourceImagesRepository.*

  override def reserveWithinQuota(
      reservation: SourceImageReservation,
      quota: SourceImageQuota,
  ): F[SourceImageReservationResult] =
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
    """).query[Row]

    val reserve =
      for
        _ <- lockAccount(reservation.ownerAccountId)
        current <- existing.option
        result: SourceImageReservationResult <- current match
          case Some(row) => SourceImageReservationResult.Existing(row.toRecord).pure[ConnectionIO]
          case None => unreferencedUsageCio(reservation.ownerAccountId).flatMap { usage =>
              evaluateQuota(usage, reservation.sizeBytes, quota) match
                case Some(rejection) => SourceImageReservationResult.Rejected(rejection)
                    .pure[ConnectionIO]
                case None => insert.flatMap {
                    case Some(row) => SourceImageReservationResult.Reserved(row.toRecord)
                        .pure[ConnectionIO]
                    case None => existing.unique
                        .map(row => SourceImageReservationResult.Existing(row.toRecord))
                  }
            }
      yield result
    reserve.transact(transactor)

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
      SET status = ${SourceImageStatus.Reserved}, failure_code = NULL,
          delete_pending_at = NULL, updated_at = $now
      WHERE id = $id
        AND status = ${SourceImageStatus.Failed}
        AND delete_pending_at IS NULL
    """.update.run.map(_ == 1).transact(transactor)

  override def claimFailedPurge(
      id: ImageId,
      olderThan: Instant,
      claimStaleBefore: Instant,
      claimedAt: Instant,
  ): F[Option[SourceImageRecord]] =
    val claim = (fr"""
      UPDATE source_images AS candidate
      SET delete_pending_at = $claimedAt
      WHERE candidate.id = $id
        AND candidate.status = ${SourceImageStatus.Failed}
        AND candidate.updated_at <= $olderThan
        AND (
          candidate.delete_pending_at IS NULL
          OR candidate.delete_pending_at <= $claimStaleBefore
        )
    """ ++ unreferencedGuard ++ returningAll).query[Row].option
    claim.map(_.map(_.toRecord)).transact(transactor)

  override def purgeClaimedFailed(id: ImageId, claimedAt: Instant): F[Boolean] = (fr"""
      DELETE FROM source_images AS candidate
      WHERE candidate.id = $id
        AND candidate.status = ${SourceImageStatus.Failed}
        AND candidate.delete_pending_at = $claimedAt
    """ ++ unreferencedGuard).update.run.map(_ == 1).transact(transactor)

  override def beginDeleteUnreferenced(
      id: ImageId,
      now: Instant,
  ): F[SourceImageDeleteResult] =
    val currentForUpdate = (selectAll ++ fr"WHERE id = $id FOR UPDATE").query[Row].option
    val update = (fr"""
      UPDATE source_images AS candidate
      SET status = ${SourceImageStatus.DeletePending}, delete_pending_at = $now, updated_at = $now
      WHERE candidate.id = $id AND candidate.status = ${SourceImageStatus.Available}
    """ ++ unreferencedGuard ++ returningAll).query[Row].option
    currentForUpdate.flatMap {
      case None => SourceImageDeleteResult.Missing.pure[ConnectionIO]
      case Some(row) if row.status == SourceImageStatus.DeletePending =>
        SourceImageDeleteResult.Pending(row.toRecord).pure[ConnectionIO]
      case Some(row) if row.status == SourceImageStatus.Deleted =>
        SourceImageDeleteResult.AlreadyDeleted.pure[ConnectionIO]
      case Some(row) if row.status != SourceImageStatus.Available =>
        SourceImageDeleteResult.NotReady(row.status).pure[ConnectionIO]
      case Some(_) => update.map {
          case Some(pending) => SourceImageDeleteResult.Pending(pending.toRecord)
          case None => SourceImageDeleteResult.NotReady(SourceImageStatus.Available)
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

  override def orphanCandidates(
      olderThan: Instant,
      limit: Int,
  ): F[List[SourceImageRecord]] =
    val boundedLimit = limit.max(1).min(MaxReconciliationBatchSize)
    (liveReferencesCte ++ selectAllAliased ++ fr"""
      WHERE candidate.status = ${SourceImageStatus.Available}
        AND candidate.updated_at <= $olderThan
    """ ++ unreferencedFromCte ++ fr"""
      ORDER BY candidate.updated_at, candidate.id
      LIMIT $boundedLimit
    """).query[Row].to[List].map(_.map(_.toRecord)).transact(transactor)

  private def unreferencedUsageCio(ownerAccountId: AccountId): ConnectionIO[UsageRow] = (
    liveReferencesCte ++ fr"""
      SELECT COUNT(*)::bigint, COALESCE(SUM(candidate.byte_length), 0)::bigint
      FROM source_images AS candidate
      WHERE candidate.owner_account_id = $ownerAccountId
        AND candidate.status <> ${SourceImageStatus.Deleted}
    """ ++ unreferencedFromCte
  ).query[UsageRow].unique

  private def lockAccount(ownerAccountId: AccountId): ConnectionIO[Unit] = sql"""
      -- The second advisory-key component is this repository's quota namespace. Hash collisions
      -- can only serialize unrelated accounts; they cannot weaken the quota decision.
      SELECT pg_advisory_xact_lock(hashtext(${ownerAccountId.value}), 1)
    """.query[Unit].unique.void

  private def evaluateQuota(
      usage: UsageRow,
      incomingBytes: Long,
      quota: SourceImageQuota,
  ): Option[SourceImageQuotaRejection] =
    val countAfter = usage.fileCount + 1L
    val bytesAfter = saturatedAdd(usage.sizeBytes, incomingBytes)
    if countAfter > quota.unreferencedCountLimit.toLong then
      Some(SourceImageQuotaRejection.CountExceeded(countAfter, quota.unreferencedCountLimit))
    else
      Option.when(bytesAfter > quota.unreferencedBytesLimit)(
        SourceImageQuotaRejection.BytesExceeded(bytesAfter, quota.unreferencedBytesLimit)
      )

  private def saturatedAdd(left: Long, right: Long): Long =
    if right > 0L && left > Long.MaxValue - right then Long.MaxValue else left + right

private[postgres] object PostgresSourceImageLifecycle:
  /**
   * Persists object-deletion intent in the same transaction that makes a draft terminal.
   *
   * Object deletion remains an external, retryable reconciliation step. Rows already outside
   * AVAILABLE are left unchanged so retries are idempotent.
   */
  def stageDeletion(imageIds: List[ImageId], now: Instant): ConnectionIO[Unit] =
    imageIds.distinct.map(_.value).sorted match
      case Nil => ().pure[ConnectionIO]
      case ids =>
        val rawIds = ids.toArray
        val lock = sql"""
          SELECT id
          FROM source_images
          WHERE id = ANY($rawIds)
          ORDER BY id
          FOR UPDATE
        """.query[String].to[List].void
        val update =
          (sql"""
          UPDATE source_images AS candidate
          SET status = ${SourceImageStatus.DeletePending},
              delete_pending_at = $now,
              updated_at = $now
          WHERE candidate.id = ANY($rawIds)
            AND candidate.status = ${SourceImageStatus.Available}
        """ ++ PostgresSourceImagesRepository.unreferencedGuard).update.run.void
        lock *> update

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

  /**
   * Builds the live-reference set once inside PostgreSQL. This avoids a correlated full
   * match_drafts scan for every quota/orphan candidate while keeping the set out of JVM heap.
   */
  private val liveReferencesCte = fr"""
    WITH live_source_image_references(image_id) AS MATERIALIZED (
      SELECT source_image_id
      FROM ocr_jobs
      WHERE status IN (${OcrJobStatus.Queued}, ${OcrJobStatus.Running})
        AND source_image_id IS NOT NULL
      UNION ALL
      SELECT image_id
      FROM ocr_jobs
      WHERE status IN (${OcrJobStatus.Queued}, ${OcrJobStatus.Running})
        AND image_id IS NOT NULL
      UNION ALL
      SELECT total_assets_image_id
      FROM match_drafts
      WHERE source_images_deleted_at IS NULL
        AND status NOT IN (${MatchDraftStatus.Confirmed}, ${MatchDraftStatus.Cancelled})
        AND total_assets_image_id IS NOT NULL
      UNION ALL
      SELECT revenue_image_id
      FROM match_drafts
      WHERE source_images_deleted_at IS NULL
        AND status NOT IN (${MatchDraftStatus.Confirmed}, ${MatchDraftStatus.Cancelled})
        AND revenue_image_id IS NOT NULL
      UNION ALL
      SELECT incident_log_image_id
      FROM match_drafts
      WHERE source_images_deleted_at IS NULL
        AND status NOT IN (${MatchDraftStatus.Confirmed}, ${MatchDraftStatus.Cancelled})
        AND incident_log_image_id IS NOT NULL
    )
  """

  private val unreferencedFromCte = fr"""
    AND NOT EXISTS (
      SELECT 1
      FROM live_source_image_references live_reference
      WHERE live_reference.image_id = candidate.id
    )
  """

  private[postgres] val unreferencedGuard = fr"""
    AND NOT EXISTS (
      SELECT 1
      FROM ocr_jobs
      WHERE (ocr_jobs.source_image_id = candidate.id OR ocr_jobs.image_id = candidate.id)
        AND ocr_jobs.status IN (${OcrJobStatus.Queued}, ${OcrJobStatus.Running})
    )
    AND NOT EXISTS (
      SELECT 1
      FROM match_drafts
      WHERE match_drafts.source_images_deleted_at IS NULL
        AND match_drafts.status NOT IN (${MatchDraftStatus.Confirmed}, ${MatchDraftStatus.Cancelled})
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
