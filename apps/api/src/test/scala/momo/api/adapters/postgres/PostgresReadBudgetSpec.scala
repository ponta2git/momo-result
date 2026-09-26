package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.IO
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.ids.*
import momo.api.domain.{GameTitle, HeldEvent, PageRequest}
import momo.api.integration.IntegrationSuite
import momo.api.testing.AppErrorAssertions.assertAppException

final class PostgresReadBudgetSpec extends IntegrationSuite:
  private val now = Instant.parse("2026-09-01T00:00:00Z")
  private val titleId = GameTitleId.unsafeFromString("budget_title")
  private val eventId = HeldEventId.unsafeFromString("budget_event")

  test("catalog permits its exact row ceiling and rejects the next row without truncating") {
    val maximum = PostgresReadBudget.CatalogRows
    val titles = PostgresGameTitlesRepository[IO](transactor)
    for
      _ <- sql"""
        INSERT INTO game_titles (id, name, layout_family, display_order, created_at)
        SELECT 'budget_title_' || n, 'Budget title ' || n, 'world', n, $now
        FROM generate_series(1, $maximum) n
      """.update.run.transact(transactor)
      accepted <- titles.list
      _ <- titles.createWithNextDisplayOrder(GameTitle(titleId, "Extra", "world", 1, now))
      rejected <- titles.list.attempt
    yield
      assertEquals(accepted.size, maximum)
      assertAppException(rejected, "PAYLOAD_TOO_LARGE", "too many records")
  }

  test("catalog text guard counts Unicode code points and preserves an exact-limit name") {
    val name = "🚀" * PostgresReadBudget.NameCodePoints
    val titles = PostgresGameTitlesRepository[IO](transactor)
    for
      _ <- titles.createWithNextDisplayOrder(GameTitle(titleId, name, "world", 1, now))
      accepted <- titles.list
      _ <- sql"UPDATE game_titles SET name = name || 'a' WHERE id = $titleId".update.run
        .transact(transactor)
      rejected <- titles.list.attempt
    yield
      assertEquals(accepted.map(_.name), List(name))
      assertAppException(rejected, "PAYLOAD_TOO_LARGE", "oversized stored text")
  }

  List("title", "map", "season", "incident", "alias").foreach { kind =>
    test(s"$kind catalog rejects a legacy oversized label at its SQL projection boundary") {
      val mutationAndRead: (Fragment, ConnectionIO[Unit]) = kind match
        case "title" => (
            sql"UPDATE game_titles SET name = repeat('x', 4096) WHERE id = $titleId",
            PostgresGameTitles.alg.list.void,
          )
        case "map" => (
            sql"UPDATE map_masters SET name = repeat('x', 4096) WHERE id = 'budget_map'",
            PostgresMapMasters.alg.list(None).void,
          )
        case "season" => (
            sql"UPDATE season_masters SET name = repeat('x', 4096) WHERE id = 'budget_season'",
            PostgresSeasonMasters.alg.list(None).void,
          )
        case "incident" => (
            sql"UPDATE incident_masters SET display_name = repeat('x', 1048576)",
            PostgresIncidentMasters.alg.list.void,
          )
        case _ => (
            sql"UPDATE member_aliases SET alias = repeat('x', 4096) WHERE id = 'budget_alias'",
            PostgresMemberAliases.alg.list(None).void,
          )
      val (mutate, read) = mutationAndRead
      for
        _ <- seedCatalog
        rejected <- (for
          _ <- mutate.update.run
          result <- read.attempt
          // Seeded incident rows are shared with other suites: always restore them.
          _ <- doobie.free.connection.rollback
        yield result).transact(transactor)
      yield assertAppException(rejected, "PAYLOAD_TOO_LARGE", "oversized stored text")
    }
  }

  test("whole-event detail rejects record overflow while the scalar summary remains available") {
    val maximum = PostgresReadBudget.HeldEventRecords
    val detail = PostgresHeldEventDetailReadModel[IO](transactor)
    for
      _ <- PostgresHeldEventsRepository[IO](transactor).create(HeldEvent(eventId, now))
      _ <- insertDrafts(1, maximum)
      accepted <- detail.find(eventId)
      _ <- insertDrafts(maximum + 1, maximum + 1)
      rejected <- detail.find(eventId).attempt
      summary <- detail.summary(eventId)
    yield
      assertEquals(accepted.map(_.drafts.size), Some(maximum))
      assertAppException(rejected, "PAYLOAD_TOO_LARGE", "too many records")
      assertEquals(summary.map(_.draftCount), Some(maximum + 1))
  }

  test("held-event scope aggregation rejects excessive groups without returning partial counts") {
    val maximum = PostgresReadBudget.ScopeRows
    for
      _ <- PostgresHeldEventsRepository[IO](transactor).create(HeldEvent(eventId, now))
      _ <- sql"""
        INSERT INTO game_titles (id, name, layout_family, display_order, created_at)
        SELECT 'scope_title_' || n, 'Scope title ' || n, 'world', n, $now
        FROM generate_series(1, ${maximum + 1}) n
      """.update.run.transact(transactor)
      _ <- sql"""
        INSERT INTO match_drafts (id, created_by_account_id, status, held_event_id,
          game_title_id, created_at, updated_at)
        SELECT 'scope_draft_' || n, 'account_ponta', 'needs_review', $eventId,
          'scope_title_' || n, $now, $now FROM generate_series(1, ${maximum + 1}) n
      """.update.run.transact(transactor)
      rejected <- PostgresHeldEventListReadModel[IO](transactor)
        .list(None, PageRequest(1, 1)).attempt
      draftStats <- PostgresMatchDraftsRepository[IO](transactor)
        .statsByHeldEvents(List(eventId)).attempt
    yield
      assertAppException(rejected, "PAYLOAD_TOO_LARGE", "too many records")
      assertAppException(draftStats, "PAYLOAD_TOO_LARGE", "too many records")
  }

  test("whole-event detail applies one combined budget before loading match children") {
    for
      _ <- seedCatalog
      _ <- PostgresHeldEventsRepository[IO](transactor).create(HeldEvent(eventId, now))
      _ <- insertDrafts(1, PostgresReadBudget.HeldEventRecords)
      _ <- sql"""
        INSERT INTO matches (id, held_event_id, match_no_in_event, game_title_id, layout_family,
          season_master_id, owner_member_id, map_master_id, played_at,
          created_by_account_id, created_by_member_id, created_at)
        VALUES ('budget_match', $eventId, 1, $titleId, 'world', 'budget_season', 'member_ponta',
          'budget_map', $now, 'account_ponta', 'member_ponta', $now)
      """.update.run.transact(transactor)
      // This extra parent has no child rows: the count guard must reject before decoding children.
      rejected <- PostgresHeldEventDetailReadModel[IO](transactor).find(eventId).attempt
    yield assertAppException(rejected, "PAYLOAD_TOO_LARGE", "too many records")
  }

  private def seedCatalog: IO[Unit] =
    for
      _ <- PostgresGameTitlesRepository[IO](transactor)
        .createWithNextDisplayOrder(GameTitle(titleId, "Budget", "world", 1, now))
      _ <- sql"""INSERT INTO map_masters (id, game_title_id, name, display_order, created_at)
        VALUES ('budget_map', $titleId, 'Map', 1, $now)""".update.run.transact(transactor)
      _ <- sql"""INSERT INTO season_masters (id, game_title_id, name, display_order, created_at)
        VALUES ('budget_season', $titleId, 'Season', 1, $now)""".update.run.transact(transactor)
      _ <- sql"""INSERT INTO member_aliases (id, member_id, alias, created_at)
        VALUES ('budget_alias', 'member_ponta', 'Alias', $now)""".update.run.transact(transactor)
    yield ()

  private def insertDrafts(from: Int, to: Int): IO[Unit] = sql"""
    INSERT INTO match_drafts (id, created_by_account_id, status, held_event_id, created_at, updated_at)
    SELECT 'budget_draft_' || n, 'account_ponta', 'needs_review', $eventId, $now, $now
    FROM generate_series($from, $to) n
  """.update.run.transact(transactor).void
