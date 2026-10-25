package momo.api.integration

import java.time.Instant

import cats.effect.IO
import cats.syntax.all.*
import doobie.implicits.*
import io.circe.Json
import org.http4s.circe.*
import org.http4s.{Method, Request, Status, Uri}

import momo.api.adapters.postgres.*
import momo.api.domain.ids.*
import momo.api.domain.{HeldEvent, PublicId}
import momo.api.http.HttpAssertions.{assertProblem, jsonField}
import momo.api.http.HttpRequestBodies
import momo.api.usecases.testing.MatchFixtures

/** Run against both the pinned legacy migrations and the public-number expand snapshot. */
final class PostgresPublicIdentifiersSpec extends PostgresHttpAppTestFixtures:
  private val now = Instant.parse("2024-01-01T00:00:00Z")
  private val titleId = GameTitleId.unsafeFromString("title_world")
  private val mapId = MapMasterId.unsafeFromString("map_east")
  private val seasonId = SeasonMasterId.unsafeFromString("season_2024_spring")

  test("public routes preserve legacy identities, authorization, edits and numeric collisions"):
    for
      mode <- PostgresPublicIds.discover.transact(transactor)
      _ <- seedMasters
      _ <- seedPair("held-public-one", "match-public-one", 0)
      _ <- seedPair("1", "1", 1)
      _ <- httpAppResource("public-identifiers").use { app =>
        for
          legacyMatch <- readJson(app, "/api/matches/1")
          legacyEvent <- readJson(app, "/api/held-events/1")
          query <- readJson(app, "/api/matches?heldEventId=1")
          _ =
            assertEquals(jsonField[String](legacyMatch, "matchId"), "1")
            assertEquals(jsonField[String](legacyEvent, "id"), "1")
            assertEquals(
              jsonField[List[Json]](query, "items").map(jsonField[String](_, "id")),
              List("1")
            )
          _ <- List("matches", "held-events").traverse_ { entity =>
            for
              unauthorized <-
                app.run(Request[IO](Method.GET, Uri.unsafeFromString(s"/api/public/$entity/1")))
              _ = assertEquals(unauthorized.status, Status.Unauthorized)
              _ <- unauthorized.body.compile.drain
              missing <- app.run(readGet(Uri.unsafeFromString(s"/api/public/$entity/999")))
              _ = assertEquals(missing.status, Status.NotFound)
              _ <- missing.body.compile.drain
              invalid <- app.run(readGet(Uri.unsafeFromString(s"/api/public/$entity/01")))
              _ <-
                assertProblem(invalid, Status.UnprocessableContent, "VALIDATION_FAILED", "publicId")
            yield ()
          }
          _ <- mode match
            case PostgresPublicIds.Legacy =>
              List("matches", "held-events").traverse_ { entity =>
                app.run(readGet(Uri.unsafeFromString(s"/api/public/$entity/1")))
                  .flatMap(response =>
                    IO(assertEquals(response.status, Status.NotFound)) *>
                      response.body.compile.drain
                  )
              } *> IO {
                assertEquals(legacyMatch.hcursor.get[Option[String]]("publicId"), Right(None))
                assertEquals(legacyEvent.hcursor.get[Option[String]]("publicId"), Right(None))
              }
            case PostgresPublicIds.Available => verifyPublicRoutes(app, legacyMatch, legacyEvent)
        yield ()
      }
    yield ()

  test("public numbers above JavaScript precision and at bigint maximum remain exact"):
    for
      mode <- PostgresPublicIds.discover.transact(transactor)
      _ <- seedMasters
      _ <- mode match
        case PostgresPublicIds.Legacy => IO.unit
        case PostgresPublicIds.Available =>
          httpAppResource("public-identifier-bounds").use { app =>
            List(9007199254740993L, Long.MaxValue).zipWithIndex.traverse_ { case (number, index) =>
              val heldId = s"held-bound-$index"
              val matchId = s"match-bound-$index"
              for
                _ <-
                  sql"SELECT setval(pg_get_serial_sequence('held_events', 'public_id'), $number, false)".query[
                    Long
                  ].unique.transact(transactor)
                _ <-
                  sql"SELECT setval(pg_get_serial_sequence('matches', 'public_id'), $number, false)".query[
                    Long
                  ].unique.transact(transactor)
                _ <- seedPair(heldId, matchId, index)
                event <- readJson(app, s"/api/public/held-events/$number")
                detail <- readJson(app, s"/api/public/matches/$number")
                _ =
                  assertEquals(jsonField[String](event, "id"), heldId)
                  assertEquals(jsonField[String](event, "publicId"), number.toString)
                  assertEquals(jsonField[String](detail, "matchId"), matchId)
                  assertEquals(jsonField[String](detail, "publicId"), number.toString)
                  assertEquals(jsonField[String](detail, "heldEventPublicId"), number.toString)
                publicId = PublicId.fromLong(number).fold(fail(_), identity)
                found <- assertReadSnapshot(xa =>
                  PostgresMatchDetailReadModel[IO](xa, mode).findByPublicId(publicId)
                )
                held <- assertReadSnapshot(xa =>
                  PostgresHeldEventDetailReadModel[IO](xa, mode).findByPublicId(publicId)
                )
                _ =
                  assertEquals(found.map(_.record.id.value), Some(matchId))
                  assertEquals(held.map(_.event.id.value), Some(heldId))
              yield ()
            } *> List("matches", "held-events").traverse_ { entity =>
              app.run(readGet(Uri.unsafeFromString(s"/api/public/$entity/9223372036854775808")))
                .flatMap(response =>
                  assertProblem(
                    response,
                    Status.UnprocessableContent,
                    "VALIDATION_FAILED",
                    "publicId"
                  )
                )
            }
          }
    yield ()

  private def verifyPublicRoutes(app: TestHttpApp, legacyMatch: Json, legacyEvent: Json): IO[Unit] =
    for
      first <- readJson(app, "/api/public/matches/1")
      held <- readJson(app, "/api/public/held-events/1")
      events <- readJson(app, "/api/held-events")
      listed <- readJson(app, "/api/matches")
      identity <- readJson(app, "/api/matches/match-public-one/identity")
      _ =
        assertEquals(jsonField[String](first, "matchId"), "match-public-one")
        assertEquals(jsonField[String](held, "id"), "held-public-one")
        assertEquals(jsonField[String](legacyMatch, "publicId"), "2")
        assertEquals(jsonField[String](legacyEvent, "publicId"), "2")
        assertEquals(jsonField[String](identity, "publicId"), "1")
        assertEquals(
          jsonField[List[Json]](held, "matches").map(jsonField[String](_, "publicId")),
          List("1")
        )
        assertEquals(
          jsonField[List[Json]](events, "items").map(jsonField[String](_, "publicId")).toSet,
          Set("1", "2")
        )
        assertEquals(
          jsonField[List[Json]](listed, "items").map(jsonField[String](_, "publicId")).toSet,
          Set("1", "2")
        )
        val nextMatch = jsonField[Json](jsonField[Json](first, "navigation"), "next")
        val nextEvent = jsonField[Json](jsonField[Json](held, "navigation"), "next")
        assertEquals(jsonField[String](nextMatch, "matchId"), "1")
        assertEquals(jsonField[String](nextMatch, "publicId"), "2")
        assertEquals(jsonField[String](nextEvent, "id"), "1")
        assertEquals(jsonField[String](nextEvent, "publicId"), "2")
      update =
        HttpRequestBodies.Matches.confirmMatchWithNo(jsonField[String](first, "heldEventId"), 9)
          .mapObject(_.add("expectedVersion", Json.fromString(jsonField[String](first, "version"))))
      target = Uri.unsafeFromString(s"/api/matches/${jsonField[String](first, "matchId")}")
      saved <- app.run(writePost(target, update, Some("public-route-edit")).withMethod(Method.PUT))
      savedBody <- saved.as[Json]
      replay <- app.run(writePost(target, update, Some("public-route-edit")).withMethod(Method.PUT))
      replayBody <- replay.as[Json]
      refreshed <- readJson(app, "/api/public/matches/1")
      untouched <- readJson(app, "/api/matches/1")
    yield
      assertEquals(saved.status, Status.Ok)
      assertEquals(replay.status, Status.Ok)
      assertEquals(replayBody, savedBody)
      assertEquals(jsonField[String](refreshed, "matchId"), "match-public-one")
      assertEquals(jsonField[Int](refreshed, "matchNoInEvent"), 9)
      assertEquals(jsonField[Int](untouched, "matchNoInEvent"), 1)

  private def readJson(app: TestHttpApp, path: String): IO[Json] =
    app.run(readGet(Uri.unsafeFromString(path))).flatMap { response =>
      assertEquals(response.status, Status.Ok)
      response.as[Json]
    }

  private def seedMasters: IO[Unit] = MatchFixtures.seedWorldMasters(
    PostgresGameTitlesRepository[IO](transactor),
    PostgresMapMastersRepository[IO](transactor),
    PostgresSeasonMastersRepository[IO](transactor),
    titleId,
    mapId,
    seasonId,
    now,
  )

  private def seedPair(heldId: String, matchId: String, index: Int): IO[Unit] =
    val heldEventId = HeldEventId.unsafeFromString(heldId)
    val at = now.plusSeconds(index.toLong)
    val record = MatchFixtures.matchRecord(
      MatchId.unsafeFromString(matchId),
      heldEventId,
      1,
      titleId,
      seasonId,
      mapId,
      at,
      at,
      MatchFixtures.DbMemberValues,
      None,
      None,
      None,
    ).copy(createdByAccountId = AccountId.unsafeFromString(DefaultAccountId))
    for
      _ <- PostgresHeldEventsRepository[IO](transactor).create(HeldEvent(heldEventId, at))
      result <- PostgresMatchConfirmationRepository[IO](transactor).confirm(record, None, at)
      _ = assert(result.isRight)
    yield ()
