package momo.api.testing

import java.nio.charset.StandardCharsets
import java.security.MessageDigest

import cats.syntax.all.*
import doobie.ConnectionIO
import doobie.implicits.*

private[api] object SeriesAnalysisPublicationFixtures:
  /**
   * Existing aggregate/context tests intentionally publish incomplete synthetic payloads to probe
   * their reader. Satisfy v6's unrelated inventory guard without treating these rows as valid
   * outlook evidence. The outlook reader tests use owner fixtures instead.
   */
  def addUnreadOutlookInventory(artifactId: String): ConnectionIO[Unit] =
    val payload = "{}".getBytes(StandardCharsets.UTF_8)
    val checksum = "sha256:" + MessageDigest.getInstance("SHA-256").digest(payload)
      .map(b => f"${b & 0xff}%02x").mkString
    sql"""UPDATE series_analysis_artifacts
      SET outlook_summary_chunk_count = 1, outlook_reference_chunk_count = 4,
          encoded_bytes = encoded_bytes + 10, decoded_bytes = decoded_bytes + 10
      WHERE id = $artifactId""".update.run.void *> sql"""
      INSERT INTO series_analysis_outlook_summary_artifacts (
        artifact_id, scope_key, scope_kind, payload, encoded_bytes, decoded_bytes,
        item_count, nesting_depth, checksum
      ) VALUES ($artifactId, 'overall', 'overall', $payload, 2, 2, 0, 1, $checksum)
    """.update.run.void *> sql"""
      INSERT INTO series_analysis_outlook_reference_artifacts (
        artifact_id, scope_key, scope_kind, member_id, payload, encoded_bytes, decoded_bytes,
        item_count, nesting_depth, checksum
      ) SELECT $artifactId, 'overall', 'overall', id, $payload, 2, 2, 1, 1,
          $checksum FROM members
    """.update.run.void
