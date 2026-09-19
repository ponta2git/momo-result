package momo.api.http

import java.nio.charset.StandardCharsets
import java.time.Instant

import cats.effect.IO
import cats.syntax.all.*
import org.http4s.implicits.*
import org.http4s.{Method, Request, Status, Uri}
import sttp.tapir.server.http4s.Http4sServerInterpreter

import momo.api.MomoCatsEffectSuite
import momo.api.adapters.inmemory.InMemoryIdempotencyRepository
import momo.api.auth.{AuthenticatedAccount, RateLimiter}
import momo.api.domain.*
import momo.api.domain.ids.{AccountId, GameTitleId}
import momo.api.endpoints.ProblemDetails
import momo.api.errors.AppError
import momo.api.http.modules.SeriesAnalysisModule
import momo.api.repositories.SeriesAnalysisRepository
import momo.api.usecases.seriesanalysis.*

final class SeriesAnalysisGenerationHttpSpec extends MomoCatsEffectSuite:
  private val bytes = """{"scope":{"kind":"overall"}}""".getBytes(StandardCharsets.UTF_8)
  private val now = Instant.parse("2026-09-01T00:00:00Z")

  test("artifact HTTP generations preserve old reads and require upgrades only after valid reads"):
    for
      idempotency <- InMemoryIdempotencyRepository.create[IO]
      limiter = new RateLimiter[IO]:
        def allow(key: String): IO[Boolean] = IO.pure(true)
      security = EndpointSecurity[IO](new AuthPolicy[IO]:
        def authenticate(context: AuthRequestContext)
            : IO[Either[ProblemDetails.ProblemResponse, AuthenticatedAccount]] = IO.pure(Right(
          AuthenticatedAccount(AccountId.unsafeFromString("account-test"), "test", false, None)
        )))
      repository = FixtureRepository()
      endpoints = SeriesAnalysisModule.routes[IO](
        GetSeriesAnalysisOptions(repository),
        GetSeriesAnalysisStatus(repository),
        GetSeriesAnalysisChunk(repository),
        GetSeriesAnalysisAdminOverview(repository),
        RequestSeriesAnalysisRecalculation(repository),
        limiter,
        IdempotencyReplay.Guard(idempotency, limiter, 10),
        IO.pure(now),
        security,
      )
      app = Http4sServerInterpreter[IO]().toRoutes(endpoints).orNotFound
      _ <- List(
        ("v2/aggregate", 2),
        ("v3/aggregate", 3),
        ("v4/aggregate", 4),
        ("v2/review", 3),
        ("v3/review", 4),
      ).traverse_ { case (path, maximumVersion) =>
        (List(2, 3, 4).map(version =>
          (
            version.toString,
            if version <= maximumVersion then Status.Ok else Status.UpgradeRequired
          )
        ) :+
          ("invalid", Status.Gone)).traverse_ { case (artifactId, expectedStatus) =>
          val uri = Uri.unsafeFromString(
            s"/api/analytics/series-comparison/$path?gameTitleId=title-test&artifactId=$artifactId"
          )
          app.run(Request[IO](Method.GET, uri)).flatMap { response =>
            response.body.compile.to(Array).map { actual =>
              assertEquals(response.status, expectedStatus, s"$path artifact=$artifactId")
              if expectedStatus.code == 200 then assertEquals(actual.toList, bytes.toList)
            }
          }
        }
      }
    yield ()

  private final class FixtureRepository extends SeriesAnalysisRepository[IO]:
    def chunk(request: SeriesAnalysisChunkRequest): IO[Either[AppError, SeriesAnalysisChunk]] =
      IO.pure(request.artifactId.toIntOption match
        case None => Left(AppError.AnalysisArtifactExpired())
        case Some(version) => Right(SeriesAnalysisChunk(
            SeriesAnalysisArtifactRef(
              request.artifactId,
              request.gameTitleId,
              0L,
              "series-analysis-v5",
              version,
              now
            ),
            request.scope,
            bytes,
          )))
    private def unused[A]: IO[A] = IO.raiseError(new AssertionError("unexpected repository call"))
    def options: IO[Either[AppError, SeriesAnalysisOptions]] = unused
    def status(id: GameTitleId): IO[Either[AppError, SeriesAnalysisStatus]] = unused
    def adminOverview(id: Option[GameTitleId]): IO[Either[AppError, SeriesAnalysisAdminOverview]] =
      unused
    def requestTitleRecalculation(id: GameTitleId, by: AccountId, key: String)
        : IO[Either[AppError, SeriesAnalysisRecalculationAccepted]] = unused
    def requestAllRecalculation(by: AccountId, key: String)
        : IO[Either[AppError, SeriesAnalysisRecalculationAccepted]] = unused
