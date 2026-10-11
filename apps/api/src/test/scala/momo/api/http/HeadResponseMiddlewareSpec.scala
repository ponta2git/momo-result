package momo.api.http

import cats.data.Kleisli
import cats.effect.IO
import cats.syntax.all.*
import fs2.Stream
import org.http4s.headers.`Content-Length`
import org.http4s.implicits.*
import org.http4s.{Header, Method, Request, Response, Status}
import org.typelevel.ci.CIString

import momo.api.MomoCatsEffectSuite

final class HeadResponseMiddlewareSpec extends MomoCatsEffectSuite with HttpAppTestFixtures:
  test("HEAD preserves routing and metadata while releasing body resources without payload work") {
    for
      admission <- RequestBodyAdmission.create[IO](1L, 1L, 1L, 1L, 1L)
      evaluated <- IO.ref(0)
      finalized <- IO.ref(0)
      methods <- IO.ref(List.empty[String])
      underlying = Kleisli[IO, Request[IO], Response[IO]] { request =>
        methods.update(_ :+ request.method.name).as(
          Response[IO](Status.MethodNotAllowed)
            .putHeaders(Header.Raw(CIString("Allow"), "GET"))
            .withBodyStream(
              (Stream.exec(evaluated.update(_ + 1)) ++ Stream.never[IO])
                .onFinalize(finalized.update(_ + 1))
            )
        )
      }
      app = RequestDurationLoggingMiddleware(HeadResponseMiddleware(admission(underlying)))
      responses <- List.fill(3)(Request[IO](Method.HEAD, uri"/api/matches"))
        .traverse(app.run)
      bodies <- responses.traverse(_.body.compile.toVector)
      payloads <- evaluated.get
      releases <- finalized.get
      seenMethods <- methods.get
    yield
      assert(responses.forall(_.status.code == Status.MethodNotAllowed.code))
      assert(responses.forall(_.headers.get(CIString("Allow")).exists(_.head.value == "GET")))
      assert(bodies.forall(_.isEmpty))
      assertEquals(payloads, 0)
      assertEquals(releases, 3)
      assertEquals(seenMethods, List.fill(3)("HEAD"))
  }

  test("HEAD terminates a pure infinite body and ordinary responses retain their content") {
    val app = HeadResponseMiddleware(Kleisli[IO, Request[IO], Response[IO]] { request =>
      IO.pure(
        if request.method.name == Method.HEAD.name then
          Response[IO](Status.Ok).withBodyStream(Stream.constant[IO, Byte](1))
        else Response[IO](Status.Ok).withEntity("ordinary content")
      )
    })
    for
      head <- app.run(Request[IO](Method.HEAD, uri"/"))
      empty <- head.body.compile.toVector
      get <- app.run(Request[IO](Method.GET, uri"/"))
      content <- get.as[String]
    yield
      assertEquals(empty, Vector.empty[Byte])
      assertEquals(content, "ordinary content")
  }

  test("the assembled application suppresses HEAD routing errors and preserves a subsequent GET") {
    httpAppResource("momo-api-head").use { app =>
      for
        rejected <- app.run(Request[IO](Method.HEAD, uri"/healthz"))
        rejectedBody <- rejected.body.compile.toVector
        missing <- app.run(Request[IO](Method.HEAD, uri"/api/not-a-route"))
        missingBody <- missing.body.compile.toVector
        unsupported <- app.run(Request[IO](Method.PUT, uri"/api/match-drafts/example"))
        _ <- unsupported.body.compile.drain
        get <- app.run(Request[IO](Method.GET, uri"/healthz"))
        getBody <- get.as[String]
      yield
        assertEquals(rejected.status, Status.MethodNotAllowed)
        assertEquals(rejected.headers.get(CIString("Allow")).map(_.head.value), Some("GET"))
        assertEquals(rejectedBody, Vector.empty[Byte])
        assertEquals(rejected.headers.get[`Content-Length`], None)
        assertEquals(missing.status, Status.NotFound)
        assertEquals(missingBody, Vector.empty[Byte])
        assertEquals(missing.headers.get[`Content-Length`], None)
        assertEquals(unsupported.status, Status.MethodNotAllowed)
        assertEquals(
          unsupported.headers.get(CIString("Allow")).map(_.head.value),
          Some("GET, PATCH"),
        )
        assertEquals(get.status, Status.Ok)
        assertEquals(getBody, "{\"status\":\"ok\"}")
    }
  }
