package momo.api.integration

import java.time.Instant

import cats.effect.IO
import cats.syntax.all.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.domain.HeldEvent
import momo.api.domain.ids.HeldEventId
import momo.api.repositories.HeldEventDeletionResult
import momo.api.repositories.postgres.PostgresMeta.given
import momo.api.repositories.postgres.{
  PostgresHeldEventDeletionRepository, PostgresHeldEventsRepository,
}

final class PostgresHeldEventDeletionRepositorySpec extends IntegrationSuite:
  private val now = Instant.parse("2026-05-15T03:00:00Z")
  private val eventId = HeldEventId.unsafeFromString("held_delete_atomic")

  private def events = PostgresHeldEventsRepository[IO](transactor)
  private def deletions = PostgresHeldEventDeletionRepository[IO](transactor)

  test("deleteIfUnreferenced deletes existing unreferenced held events"):
    for
      _ <- events.create(HeldEvent(eventId, now))
      result <- deletions.deleteIfUnreferenced(eventId)
      found <- events.find(eventId)
    yield
      assertEquals(result, HeldEventDeletionResult.Deleted)
      assertEquals(found, None)

  test("deleteIfUnreferenced reports missing held events"):
    deletions.deleteIfUnreferenced(eventId)
      .map(result => assertEquals(result, HeldEventDeletionResult.NotFound))

  test("deleteIfUnreferenced reports match draft references without deleting"):
    for
      _ <- events.create(HeldEvent(eventId, now))
      _ <- sql"""
        INSERT INTO match_drafts (
          id, created_by_account_id, created_by_member_id, status, held_event_id,
          created_at, updated_at
        ) VALUES (
          'draft_delete_atomic', 'account_ponta', 'member_ponta', 'needs_review', $eventId,
          $now, $now
        )
      """.update.run.transact(transactor)
      result <- deletions.deleteIfUnreferenced(eventId)
      found <- events.find(eventId)
    yield
      assertEquals(result, HeldEventDeletionResult.HasMatchDrafts)
      assertEquals(found, Some(HeldEvent(eventId, now)))

  test("deleteIfUnreferenced reports confirmed match references without deleting"):
    for
      _ <- events.create(HeldEvent(eventId, now))
      _ <- seedMatchPrerequisites
      _ <- sql"""
        INSERT INTO matches (
          id, held_event_id, match_no_in_event, game_title_id, layout_family,
          season_master_id, owner_member_id, map_master_id, played_at,
          created_by_account_id, created_by_member_id, created_at, updated_at
        ) VALUES (
          'match_delete_atomic', $eventId, 1, 'title_delete_atomic', 'world',
          'season_delete_atomic', 'member_ponta', 'map_delete_atomic', $now,
          'account_ponta', 'member_ponta', $now, $now
        )
      """.update.run.transact(transactor)
      result <- deletions.deleteIfUnreferenced(eventId)
      found <- events.find(eventId)
    yield
      assertEquals(result, HeldEventDeletionResult.HasConfirmedMatches)
      assertEquals(found, Some(HeldEvent(eventId, now)))

  private def seedMatchPrerequisites: IO[Unit] = List(
    sql"""
      INSERT INTO game_titles (id, name, layout_family, display_order, created_at)
      VALUES ('title_delete_atomic', 'Delete Atomic', 'world', 1, $now)
    """,
    sql"""
      INSERT INTO map_masters (id, game_title_id, name, display_order, created_at)
      VALUES ('map_delete_atomic', 'title_delete_atomic', 'Delete Map', 1, $now)
    """,
    sql"""
      INSERT INTO season_masters (id, game_title_id, name, display_order, created_at)
      VALUES ('season_delete_atomic', 'title_delete_atomic', 'Delete Season', 1, $now)
    """,
  ).traverse_(_.update.run.transact(transactor))
