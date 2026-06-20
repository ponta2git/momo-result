package momo.api.repositories.postgres

import java.time.Instant

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.circe.jsonb.implicits.*
import doobie.postgres.implicits.*
import io.circe.{parser, Json}

import momo.api.db.Database
import momo.api.domain.ids.*
import momo.api.domain.{OcrDraft, ScreenType}
import momo.api.repositories.postgres.PostgresMeta.given
import momo.api.repositories.{OcrDraftsAlg, OcrDraftsRepository}

object PostgresOcrDrafts:

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

  private def asJson(raw: String, fieldName: String): ConnectionIO[Json] = parser.parse(raw)
    .leftMap(error =>
      new IllegalArgumentException(s"ocr draft $fieldName must be valid JSON: ${error.message}")
    ).liftTo[ConnectionIO]

  val alg: OcrDraftsAlg[ConnectionIO] = new OcrDraftsAlg[ConnectionIO]:
    override def create(draft: OcrDraft): ConnectionIO[Unit] =
      for
        payload <- asJson(draft.payloadJson, "payloadJson")
        warnings <- asJson(draft.warningsJson, "warningsJson")
        timings <- asJson(draft.timingsMsJson, "timingsMsJson")
        _ <- sql"""
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
      """.update.run.void
      yield ()

    override def find(draftId: OcrDraftId): ConnectionIO[Option[OcrDraft]] = sql"""
        SELECT id, job_id, requested_screen_type, detected_screen_type, profile_id,
               payload_json, warnings_json, timings_ms_json, created_at, updated_at
        FROM ocr_drafts
        WHERE id = $draftId
      """.query[Row].option.map(_.map(toDraft))
end PostgresOcrDrafts

/** Backwards-compatible class facade. */
final class PostgresOcrDraftsRepository[F[_]: MonadCancelThrow](transactor: Transactor[F])
    extends OcrDraftsRepository[F]:
  private val delegate: OcrDraftsRepository[F] = OcrDraftsRepository
    .fromAlg(PostgresOcrDrafts.alg, Database.transactK(transactor))

  export delegate.*
end PostgresOcrDraftsRepository
