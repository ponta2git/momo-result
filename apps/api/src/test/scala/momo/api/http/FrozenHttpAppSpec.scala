package momo.api.http

import cats.effect.{IO, Ref}
import cats.syntax.all.*
import io.circe.parser.parse
import org.http4s.{Header, Method, Request, Status, Uri}

import momo.api.MomoCatsEffectSuite
import momo.api.maintenance.DatabaseConnectionProof

final class FrozenHttpAppSpec extends MomoCatsEffectSuite:
  private val proof = DatabaseConnectionProof.fromSnapshot(
    "postgresql://fixture.invalid/configured",
    "actual",
    List(DatabaseConnectionProof.LedgerRow("a" * 64, "1730000000000")),
  ).fold(error => fail(error.getMessage), identity)

  private val readinessRequest =
    Request[IO](uri = Uri.unsafeFromString(FrozenHttpApp.ReadinessPath))
      .putHeaders(Header.Raw(
        RuntimeHttp2ProbeMiddleware.HeaderName,
        RuntimeHttp2ProbeMiddleware.HeaderValue,
      ))

  test("all normal routes and methods close before authentication or readiness work"):
    for
      calls <- Ref.of[IO, Int](0)
      app = FrozenHttpApp(calls.update(_ + 1).as(proof))
      _ <- List(
        "/api/auth/me",
        "/api/auth/callback",
        "/api/ocr/jobs",
        "/api/images",
        "/api/match-drafts/draft",
        "/api/admin/series-analysis/recalculations",
        "/healthz/details",
        FrozenHttpApp.ReadinessPath,
      ).traverse_ { path =>
        List(Method.GET, Method.POST, Method.PUT, Method.PATCH, Method.DELETE).traverse_ { method =>
          for
            response <- app.run(Request[IO](method, Uri.unsafeFromString(path)))
            body <- response.as[String]
          yield
            assertEquals(response.status, Status.ServiceUnavailable)
            assertEquals(body, "{\"status\":\"maintenance\",\"mode\":\"frozen\"}")
        }
      }
      health <- app.run(Request[IO](uri = Uri.unsafeFromString("/healthz")))
      healthBody <- health.as[String]
      count <- calls.get
    yield
      assertEquals(count, 0)
      assertEquals(health.status, Status.Ok)
      assertEquals(parse(healthBody).flatMap(_.hcursor.get[String]("status")), Right("maintenance"))

  test("dedicated readiness returns only fixed state and database fingerprints"):
    for
      calls <- Ref.of[IO, Int](0)
      response <- FrozenHttpApp(calls.update(_ + 1).as(proof)).run(readinessRequest)
      body <- response.as[String]
      count <- calls.get
    yield
      assertEquals(count, 1)
      assertEquals(response.status, Status.Ok)
      assertEquals(
        parse(body),
        parse(
          s"""{"status":"ready","mode":"frozen","database":${proof.toJson.noSpaces}}"""
        )
      )

  test("readiness failures cannot expose connection or stored data"):
    val failed =
      IO.raiseError[DatabaseConnectionProof](new IllegalStateException("connection-and-row-secret"))
    for
      response <- FrozenHttpApp(failed).run(readinessRequest)
      body <- response.as[String]
    yield
      assertEquals(response.status, Status.ServiceUnavailable)
      assertEquals(body, "{\"status\":\"unavailable\",\"mode\":\"frozen\"}")
