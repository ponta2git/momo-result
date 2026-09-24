package momo.api.http

import java.nio.charset.StandardCharsets

import cats.effect.IO
import munit.CatsEffectSuite
import org.http4s.implicits.*
import org.http4s.{MediaType, Method, Request, Status}
import sttp.tapir.server.http4s.Http4sServerInterpreter

import momo.api.endpoints.{ProblemDetails, SeriesAnalysisEndpoints}

final class SeriesAnalysisRawJsonEndpointSpec extends CatsEffectSuite:
  test("artifact endpoint writes the bounded JSON bytes unchanged"):
    val expected = """{"schemaVersion":5,"displayName":"総合"}"""
      .getBytes(StandardCharsets.UTF_8)
    val endpoint = SeriesAnalysisEndpoints.aggregateV4
      .serverSecurityLogic[Unit, IO](_ =>
        IO.pure(Right[ProblemDetails.ProblemResponse, Unit](()))
      )
      .serverLogicSuccess(_ => _ => IO.pure(expected))
    val app = Http4sServerInterpreter[IO]().toRoutes(endpoint).orNotFound
    val request = Request[IO](
      Method.GET,
      uri"/api/analytics/series-comparison/v4/aggregate?gameTitleId=title-wire&artifactId=artifact-wire",
    )

    for
      response <- app.run(request)
      bytes <- response.body.compile.to(Array)
    yield
      assertEquals(response.status, Status.Ok)
      assertEquals(response.contentType.map(_.mediaType), Some(MediaType.application.json))
      assertEquals(bytes.toList, expected.toList)
  test("match context uses v3 and forwards the bounded response without rewriting it"):
    val expected = """{"inclusion":{"status":"not_in_artifact"},"match":null}"""
      .getBytes(StandardCharsets.UTF_8)
    val endpoint = SeriesAnalysisEndpoints.matchContext
      .serverSecurityLogic[Unit, IO](_ =>
        IO.pure(Right[ProblemDetails.ProblemResponse, Unit](()))
      )
      .serverLogicSuccess(_ =>
        input =>
          IO {
            assertEquals(input.matchId, "match-wire")
            expected
          }
      )
    val app = Http4sServerInterpreter[IO]().toRoutes(endpoint).orNotFound
    for
      response <- app.run(Request[IO](
        Method.GET,
        uri"/api/analytics/series-comparison/v3/match-context?gameTitleId=title-wire&artifactId=artifact-wire&matchId=match-wire",
      ))
      bytes <- response.body.compile.to(Array)
      obsolete <- app.run(Request[IO](
        Method.GET,
        uri"/api/analytics/series-comparison/v2/match-context?gameTitleId=title-wire&artifactId=artifact-wire&matchId=match-wire",
      ))
    yield
      assertEquals(response.status, Status.Ok)
      assertEquals(response.contentType.map(_.mediaType), Some(MediaType.application.json))
      assertEquals(bytes.toList, expected.toList)
      assertEquals(obsolete.status, Status.NotFound)
end SeriesAnalysisRawJsonEndpointSpec
