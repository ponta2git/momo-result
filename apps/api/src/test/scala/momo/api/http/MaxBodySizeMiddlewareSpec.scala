package momo.api.http

import cats.data.Kleisli
import cats.effect.IO
import fs2.Stream
import io.circe.Json
import org.http4s.{Header, HttpApp, Method, Request, Response, Status, Uri}
import org.typelevel.ci.CIString
import sttp.tapir.*
import sttp.tapir.json.circe.*
import sttp.tapir.server.http4s.Http4sServerInterpreter

import momo.api.MomoCatsEffectSuite
import momo.api.http.HttpAssertions.assertProblem

final class MaxBodySizeMiddlewareSpec extends MomoCatsEffectSuite:
  test("wouldExceedLimit rejects chunks without overflowing near Long.MaxValue") {
    assert(MaxBodySizeMiddleware.wouldExceedLimit(Long.MaxValue - 1L, 2L, Long.MaxValue))
  }

  test("wouldExceedLimit allows chunks that exactly reach the limit") {
    assert(!MaxBodySizeMiddleware.wouldExceedLimit(1L, 2L, 3L))
  }

  test("oversized Content-Length is rejected without invoking the handler or pulling the body") {
    for
      effects <- IO.ref(0)
      app: HttpApp[IO] = Kleisli(_ => effects.update(_ + 1).as(Response[IO](Status.Ok)))
      request = Request[IO](Method.POST, Uri.unsafeFromString("/api/test"))
        .withBodyStream(Stream.eval(effects.update(_ + 1)).drain)
        .putHeaders(Header.Raw(CIString("Content-Length"), "5"))
      response <- MaxBodySizeMiddleware.requestAndUpload[IO](4, 8)(app).run(request)
      _ <- assertProblem(response, Status.PayloadTooLarge, "PAYLOAD_TOO_LARGE", "Request body")
      count <- effects.get
    yield assertEquals(count, 0)
  }

  test("chunked JSON stops at the request limit and returns 413 through the Tapir decoder") {
    for
      pulls <- IO.ref(0)
      decoded <- IO.ref(0)
      route = endpoint.post.in("api" / "test").in(jsonBody[Json]).out(jsonBody[Json])
        .serverLogicSuccess[IO](json => decoded.update(_ + 1).as(json))
      app = Http4sServerInterpreter[IO](HttpRoutes.serverOptions[IO]).toRoutes(route).orNotFound
      body = Stream.emits[IO, String](List("{\"value\":\"", "1234567890", "\"}"))
        .evalTap(_ => pulls.update(_ + 1)).flatMap(value =>
          Stream.emits(value.getBytes(java.nio.charset.StandardCharsets.UTF_8))
        )
      request = Request[IO](Method.POST, Uri.unsafeFromString("/api/test")).withBodyStream(body)
        .putHeaders(Header.Raw(CIString("Content-Type"), "application/json"))
      response <- MaxBodySizeMiddleware.requestAndUpload[IO](12, 24)(app).run(request)
      _ <- assertProblem(response, Status.PayloadTooLarge, "PAYLOAD_TOO_LARGE", "Request body")
      pullCount <- pulls.get
      decodedCount <- decoded.get
    yield
      assertEquals(pullCount, 2)
      assertEquals(decodedCount, 0)
  }

  test("only the image upload route receives the larger body allowance") {
    val app: HttpApp[IO] = Kleisli(request =>
      request.body.compile.count.map(bytes =>
        Response[IO](Status.Ok).withEntity(bytes.toString)
      )
    )
    val limited = MaxBodySizeMiddleware.requestAndUpload[IO](4, 8)(app)
    def request(path: String): Request[IO] = Request[IO](Method.POST, Uri.unsafeFromString(path))
      .withBodyStream(Stream.emits[IO, Byte](Array.fill[Byte](8)(1)))
    for
      upload <- limited.run(request("/api/uploads/images"))
      body <- upload.as[String]
      encoded <- limited.run(request("/%61pi/%75ploads/images"))
      encodedBody <- encoded.as[String]
      other <- limited.run(request("/api/uploads/other"))
      _ <- assertProblem(other, Status.PayloadTooLarge, "PAYLOAD_TOO_LARGE", "Request body")
    yield
      assertEquals(upload.status, Status.Ok)
      assertEquals(body, "8")
      assertEquals(encoded.status, Status.Ok)
      assertEquals(encodedBody, "8")
  }
