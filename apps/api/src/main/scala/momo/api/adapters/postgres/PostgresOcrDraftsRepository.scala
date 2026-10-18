package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.circe.jsonb.implicits.*
import doobie.postgres.implicits.*
import io.circe.{parser, Json}

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.ids.*
import momo.api.domain.{OcrDraft, ScreenType}
import momo.api.errors.{AppError, AppException}
import momo.api.repositories.{OcrDraftsAlg, OcrDraftsRepository}

object PostgresOcrDrafts:
  // The worker accepts 512 KiB of compact draft JSON (ocr/control.rs), within its 1 MiB
  // child-response contract. Allow PostgreSQL's jsonb textual spacing without tying result
  // size to the independent 3 MiB input-image limit. A bulk request has its own total budget.
  private[postgres] val MaximumDraftJsonBytes = 1024L * 1024L
  private[postgres] val MaximumBatchJsonBytes = 2L * MaximumDraftJsonBytes

  private[postgres] final case class Row(
      id: OcrDraftId,
      jobId: OcrJobId,
      requestedScreenType: ScreenType,
      detectedScreenType: Option[ScreenType],
      profileId: Option[String],
      payloadJson: String,
      warningsJson: String,
      timingsMsJson: String,
      createdAt: Instant,
      updatedAt: Instant,
  )

  private[postgres] def toDraft(r: Row): OcrDraft = OcrDraft(
    id = r.id,
    jobId = r.jobId,
    requestedScreenType = r.requestedScreenType,
    detectedScreenType = r.detectedScreenType,
    profileId = r.profileId,
    payloadJson = r.payloadJson,
    warningsJson = r.warningsJson,
    timingsMsJson = r.timingsMsJson,
    createdAt = r.createdAt,
    updatedAt = r.updatedAt,
  )

  private def asJson(raw: String, fieldName: String): ConnectionIO[Json] = parser.parse(raw)
    .leftMap(error =>
      new IllegalArgumentException(s"ocr draft $fieldName must be valid JSON: ${error.message}")
    ).liftTo[ConnectionIO]

  def alg(using ids: PostgresIdentities): OcrDraftsAlg[ConnectionIO] =
    new OcrDraftsAlg[ConnectionIO]:
      override def create(draft: OcrDraft): ConnectionIO[Unit] =
        for
          newId <- ids.newId(draft.id.value)
          jobId <- ids.retainedValue(Entity.OcrJobs, draft.jobId.value)
          payload <- asJson(draft.payloadJson, "payloadJson")
          warnings <- asJson(draft.warningsJson, "warningsJson")
          timings <- asJson(draft.timingsMsJson, "timingsMsJson")
          _ <- sql"""
        INSERT INTO ocr_drafts (
          ${ids.idColumns}, job_id ${ids.legacyColumn("job_id")},
          requested_screen_type, detected_screen_type, profile_id,
          payload_json, warnings_json, timings_ms_json,
          created_at, updated_at
        ) VALUES (
          $newId, $jobId ${ids.legacyValue(draft.jobId.value)},
          ${draft.requestedScreenType}, ${draft.detectedScreenType}, ${draft.profileId},
          $payload, $warnings, $timings,
          ${draft.createdAt}, ${draft.updatedAt}
        )
      """.update.run.void
        yield ()

      override def find(draftId: OcrDraftId): ConnectionIO[Option[OcrDraft]] =
        findMany(List(draftId)).map(_.get(draftId))

      override def findMany(
          draftIds: List[OcrDraftId]
      ): ConnectionIO[Map[OcrDraftId, OcrDraft]] =
        boundedRequestedRows(draftIds).flatMap(_.traverse { case (requested, row) =>
          row.toRight(readTooLarge).liftTo[ConnectionIO].map(value => requested -> toDraft(value))
        }).map(_.toMap)

  /** A rejected row is SQL NULL, so neither JSON nor oversized metadata crosses JDBC. */
  private[postgres] def boundedRows(draftIds: List[OcrDraftId])(using
      ids: PostgresIdentities): ConnectionIO[List[Option[Row]]] =
    boundedRequestedRows(draftIds).map(_.map(_._2))

  private def boundedRequestedRows(draftIds: List[OcrDraftId])(using
      ids: PostgresIdentities): ConnectionIO[List[(OcrDraftId, Option[Row])]] =
    if draftIds.isEmpty then List.empty[(OcrDraftId, Option[Row])].pure[ConnectionIO]
    else if draftIds.length > OcrDraft.MaxBulkIds then
      readTooLarge.raiseError[ConnectionIO, List[(OcrDraftId, Option[Row])]]
    else
      // Preserve multiplicities: the HTTP bulk response repeats a requested draft for every
      // occurrence, even though storage lookup returns a map of distinct identities.
      val rawIds = draftIds.map(_.value).toArray
      val nativeIds = ids.lookupArray(Entity.OcrDrafts, draftIds.map(_.value))
      sql"""
        WITH requested AS (
          SELECT requested_id, id, COUNT(*) AS occurrences
          FROM unnest($rawIds, $nativeIds) AS request(requested_id, id) GROUP BY requested_id, id
        ), selected AS MATERIALIZED (
          SELECT draft.*, requested.requested_id, requested.occurrences,
                 octet_length(payload_json::text)::bigint +
                 octet_length(warnings_json::text)::bigint +
                 octet_length(timings_ms_json::text)::bigint AS json_bytes,
                 octet_length(${ids.wireId("draft")}) BETWEEN 1 AND 128 AND
                 octet_length(${ids.retainedColumn("draft", "job_id")}) BETWEEN 1 AND 128 AND
                 octet_length(requested_screen_type) <= 32 AND
                 COALESCE(octet_length(detected_screen_type), 0) <= 32 AND
                 COALESCE(octet_length(profile_id), 0) <= 128 AS metadata_bounded
          FROM ocr_drafts draft JOIN requested ON requested.id = draft.id
        ), budget AS (
          SELECT COALESCE(bool_and(json_bytes <= $MaximumDraftJsonBytes AND metadata_bounded), true)
                 AND COALESCE(SUM(json_bytes * occurrences), 0) <= $MaximumBatchJsonBytes AS allowed
          FROM selected
        )
        SELECT requested_id, CASE WHEN allowed THEN ${ids.wireId("selected")} END,
               CASE WHEN allowed THEN ${ids.retainedColumn("selected", "job_id")} END,
               CASE WHEN allowed THEN requested_screen_type END,
               CASE WHEN allowed THEN detected_screen_type END,
               CASE WHEN allowed THEN profile_id END,
               CASE WHEN allowed THEN payload_json::text END,
               CASE WHEN allowed THEN warnings_json::text END,
               CASE WHEN allowed THEN timings_ms_json::text END,
               CASE WHEN allowed THEN created_at END,
               CASE WHEN allowed THEN updated_at END
        FROM selected CROSS JOIN budget
      """.query[(OcrDraftId, Option[Row])].to[List]

  private def readTooLarge: AppException = AppException(AppError.PayloadTooLarge(
    "Stored OCR data exceeds the supported read size. Request fewer drafts or run OCR again."
  ))
end PostgresOcrDrafts

final class PostgresOcrDraftsRepository[F[_]: MonadCancelThrow](
    transactor: Transactor[F],
    identities: PostgresIdentities = PostgresIdentities.Legacy
) extends OcrDraftsRepository[F]:
  private given PostgresIdentities = identities
  private val delegate: OcrDraftsRepository[F] = OcrDraftsRepository
    .fromAlg(PostgresOcrDrafts.alg, transactor.trans)

  export delegate.*
end PostgresOcrDraftsRepository
