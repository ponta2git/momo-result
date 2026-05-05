package momo.api.repositories.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.circe.jsonb.implicits.*
import doobie.postgres.implicits.*
import io.circe.{parser, Json}

import momo.api.domain.ids.*
import momo.api.domain.{OcrDraft, ScreenType}
import momo.api.repositories.OcrDraftsRepository
import momo.api.repositories.postgres.PostgresMeta.given

final class PostgresOcrDraftsRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends OcrDraftsRepository[F]:

  private type Row = (
      OcrDraftId,
      OcrJobId,
      ScreenType,
      Option[ScreenType],
      Option[String],
      Json,
      Json,
      Json,
      Instant,
      Instant,
  )

  private def toDraft(r: Row): OcrDraft = OcrDraft(
    id = r._1,
    jobId = r._2,
    requestedScreenType = r._3,
    detectedScreenType = r._4,
    profileId = r._5,
    payloadJson = r._6.noSpaces,
    warningsJson = r._7.noSpaces,
    timingsMsJson = r._8.noSpaces,
    createdAt = r._9,
    updatedAt = r._10,
  )

  private def asJson(raw: String): Json = parser.parse(raw).getOrElse(Json.Null)

  override def create(draft: OcrDraft): F[Unit] =
    val payload = asJson(draft.payloadJson)
    val warnings = asJson(draft.warningsJson)
    val timings = asJson(draft.timingsMsJson)
    sql"""
      INSERT INTO ocr_drafts (
        id, job_id,
        requested_screen_type, detected_screen_type, profile_id,
        payload_json, warnings_json, timings_ms_json,
        created_at, updated_at
      ) VALUES (
        ${draft.id}, ${draft.jobId},
        ${draft.requestedScreenType}, ${draft.detectedScreenType}, ${draft.profileId},
        $payload, $warnings, $timings,
        ${draft.createdAt}, ${draft.updatedAt}
      )
    """.update.run.void.transact(transactor)

  override def find(draftId: OcrDraftId): F[Option[OcrDraft]] = sql"""
      SELECT id, job_id, requested_screen_type, detected_screen_type, profile_id,
             payload_json, warnings_json, timings_ms_json, created_at, updated_at
      FROM ocr_drafts
      WHERE id = $draftId
    """.query[Row].option.map(_.map(toDraft)).transact(transactor)
end PostgresOcrDraftsRepository
