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
    val expected = """{"schemaVersion":2,"displayName":"総合"}"""
      .getBytes(StandardCharsets.UTF_8)
    val endpoint = SeriesAnalysisEndpoints.aggregate
      .serverSecurityLogic[Unit, IO](_ =>
        IO.pure(Right[ProblemDetails.ProblemResponse, Unit](()))
      )
      .serverLogicSuccess(_ => _ => IO.pure(expected))
    val app = Http4sServerInterpreter[IO]().toRoutes(endpoint).orNotFound
    val request = Request[IO](
      Method.GET,
      uri"/api/analytics/series-comparison/v2/aggregate?gameTitleId=title-wire&artifactId=artifact-wire",
    )

    for
      response <- app.run(request)
      bytes <- response.body.compile.to(Array)
    yield
      assertEquals(response.status, Status.Ok)
      assertEquals(response.contentType.map(_.mediaType), Some(MediaType.application.json))
      assertEquals(bytes.toList, expected.toList)
end SeriesAnalysisRawJsonEndpointSpec
