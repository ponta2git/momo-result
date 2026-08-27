package momo.api.http

import cats.effect.IO
import io.circe.parser.parse
import org.http4s.Status
import org.typelevel.ci.CIString

import momo.api.MomoCatsEffectSuite
import momo.api.errors.AppError

final class HttpProblemResponseSpec extends MomoCatsEffectSuite:
  test("builds JSON ProblemDetails responses through the public sanitization contract"):
    val secret = "postgres://user:secret@db.example.com/momo"
    val response = HttpProblemResponse.fromError[IO](AppError.Internal(s"leaked $secret"))

    for
      body <- response.as[String]
      json <- IO.fromEither(parse(body))
    yield
      assertEquals(response.status, Status.InternalServerError)
      assertEquals(
        response.contentType.map(_.mediaType),
        Some(org.http4s.MediaType.application.json),
      )
      assertEquals(json.hcursor.get[String]("code"), Right("INTERNAL_ERROR"))
      assertEquals(
        json.hcursor.get[String]("detail"),
        Right("予期しないエラーが発生しました。もう一度お試しください。"),
      )
      assert(!body.contains(secret))

  test("analysis read saturation returns a bounded Retry-After header"):
    val response = HttpProblemResponse.fromError[IO](AppError.AnalysisReadBusy(3))

    assertEquals(response.status, Status.ServiceUnavailable)
    assertEquals(response.headers.get(CIString("Retry-After")).map(_.head.value), Some("3"))
