package momo.api.integration

import java.sql.SQLException

import cats.effect.IO
import cats.syntax.all.*
import doobie.Fragment
import doobie.implicits.*

import momo.api.adapters.postgres.PostgresIdentities

/** Exercise the write that must fail even when every child key is new. */
trait PublishedArtifactInsertContract extends IntegrationSuite:
  protected def assertPublishedChunkInsertsRejected(artifactId: String): IO[Unit] =
    val checksum = "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"

    def probe(table: String, itemCount: Int, keys: Fragment, values: Fragment): IO[Unit] =
      val insert = fr"INSERT INTO" ++ Fragment.const(s"series_analysis_${table}_artifacts") ++
        fr"(artifact_id, payload, encoded_bytes, decoded_bytes, nesting_depth, checksum, item_count," ++
        keys ++ fr") VALUES ($artifactId, decode('7b7d', 'hex'), 2, 2, 1, $checksum, $itemCount," ++
        values ++ fr")"
      insert.update.run.transact(transactor).attemptNarrow[SQLException].map {
        case Left(error) =>
          assertEquals(error.getSQLState, "P0001", table)
          assert(
            error.getMessage.contains("attested series analysis artifact payloads are immutable"),
            table
          )
        case Right(rows) => fail(s"$table accepted $rows new chunks on a published artifact")
      }

    val seasonScope = fr"scope_key, scope_kind, season_master_id"
    val season = fr"'season:guard-season', 'season', 'guard-season'"
    val common = List(
      probe("scope_aggregate", 0, seasonScope, season),
      probe("scope_review", 0, seasonScope, season),
      probe(
        "drilldown",
        0,
        fr"scope_key, scope_kind, member_id, metric_id",
        fr"'overall', 'overall', 'member_ponta', 'expectedRankGap.evidence'"
      ),
      probe(
        "match_context",
        0,
        fr"scope_key, scope_kind, match_id, source_match_revision",
        fr"'overall', 'overall', 'guard-match', 1"
      ),
      probe("outlook_summary", 0, seasonScope, season),
      probe(
        "outlook_reference",
        1,
        fr"scope_key, scope_kind, member_id",
        fr"'overall', 'overall', 'guard-member'"
      ),
    )
    val achievements = Option.when(identitySchema == PostgresIdentities.Canonical) {
      probe("achievement", 0, fr"scope_key, scope_kind", fr"'overall', 'overall'")
    }
    (common ++ achievements).sequence_
