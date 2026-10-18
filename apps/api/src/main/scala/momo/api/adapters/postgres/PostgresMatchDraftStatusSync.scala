package momo.api.adapters.postgres

import java.time.Instant

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.MatchDraftStatus
import momo.api.domain.ids.{MatchDraftId, OcrDraftId, OcrJobId}

/** Serializes terminal OCR slot projection onto the owning persisted match-draft status. */
private[api] object PostgresMatchDraftStatusSync:
  def lockForJob(jobId: OcrJobId)(using ids: PostgresIdentities): ConnectionIO[Unit] =
    lock(touchedByJob(jobId))

  def recomputeForJob(jobId: OcrJobId, now: Instant)(using
      ids: PostgresIdentities): ConnectionIO[Unit] =
    recompute(touchedByJob(jobId), now)

  def lockForDrafts(draftIds: List[OcrDraftId])(using ids: PostgresIdentities): ConnectionIO[Unit] =
    if draftIds.isEmpty then ().pure[ConnectionIO]
    else lock(touchedByDrafts(draftIds))

  def recomputeForDrafts(draftIds: List[OcrDraftId], now: Instant)(using
      ids: PostgresIdentities): ConnectionIO[Unit] =
    if draftIds.isEmpty then ().pure[ConnectionIO]
    else recompute(touchedByDrafts(draftIds), now)

  /**
   * All cross-language terminal writers acquire these rows before locking/updating OCR jobs. The
   * recomputation runs in a later statement, so a waiter also gets a fresh READ COMMITTED snapshot
   * after the previous writer commits.
   */
  private def lock(touchedCondition: Fragment)(using ids: PostgresIdentities): ConnectionIO[Unit] =
    (fr"""SELECT ${ids.wireId("md")}
      FROM match_drafts md
      WHERE md.status = ${MatchDraftStatus.OcrRunning}
        AND (""" ++ touchedCondition ++ fr") ORDER BY ${ids.wireId("md")} FOR UPDATE OF md")
      .query[MatchDraftId].stream.compile.drain

  private def touchedByJob(jobId: OcrJobId)(using ids: PostgresIdentities): Fragment = fr"""EXISTS (
    SELECT 1
    FROM ocr_jobs changed_job
    WHERE changed_job.id = ${ids.lookup(Entity.OcrJobs, jobId.value)}
      AND changed_job.draft_id IN (
        md.total_assets_draft_id,
        md.revenue_draft_id,
        md.incident_log_draft_id
      )
  )"""

  private def touchedByDrafts(draftIds: List[OcrDraftId])(using ids: PostgresIdentities): Fragment =
    val values = draftIds.map(_.value).distinct
    fr"""(
      ${ids.retainedIn("md", "total_assets_draft_id", values)}
      OR ${ids.retainedIn("md", "revenue_draft_id", values)}
      OR ${ids.retainedIn("md", "incident_log_draft_id", values)}
    )"""

  private def recompute(touchedCondition: Fragment, now: Instant): ConnectionIO[Unit] =
    (fr"""WITH touched AS (
      SELECT md.id
      FROM match_drafts md
      WHERE md.status = ${MatchDraftStatus.OcrRunning}
        AND (""" ++ touchedCondition ++ fr"""
        )
    ),
    slot_jobs AS (
      SELECT
        md.id AS match_draft_id,
        job.status AS job_status,
        COALESCE(jsonb_array_length(ocr_draft.warnings_json), 0) AS warning_count
      FROM match_drafts md
      JOIN touched ON touched.id = md.id
      JOIN LATERAL unnest(
        ARRAY[md.total_assets_draft_id, md.revenue_draft_id, md.incident_log_draft_id]
      ) AS slot(ocr_draft_id) ON slot.ocr_draft_id IS NOT NULL
      LEFT JOIN ocr_jobs job ON job.draft_id = slot.ocr_draft_id
      LEFT JOIN ocr_drafts ocr_draft ON ocr_draft.id = slot.ocr_draft_id
    ),
    next_status AS (
      SELECT
        match_draft_id,
        CASE
          WHEN COUNT(*) FILTER (
            WHERE job_status IN ('queued', 'running') OR job_status IS NULL
          ) > 0 THEN ${MatchDraftStatus.OcrRunning}
          WHEN COUNT(*) FILTER (
            WHERE job_status IN ('failed', 'cancelled')
          ) > 0 THEN ${MatchDraftStatus.OcrFailed}
          WHEN COUNT(*) FILTER (WHERE warning_count > 0) > 0
            THEN ${MatchDraftStatus.NeedsReview}
          ELSE ${MatchDraftStatus.DraftReady}
        END AS status
      FROM slot_jobs
      GROUP BY match_draft_id
    )
    UPDATE match_drafts md
    SET status = next_status.status,
        updated_at = $now
    FROM next_status
    WHERE md.id = next_status.match_draft_id
      AND md.status = ${MatchDraftStatus.OcrRunning}
      AND md.status <> next_status.status
    """).update.run.void
end PostgresMatchDraftStatusSync
