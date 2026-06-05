package momo.api.http

import cats.effect.IO
import io.circe.parser.parse
import org.http4s.Status

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
      assertEquals(json.hcursor.get[String]("detail"), Right("Unexpected server error."))
      assert(!body.contains(secret))

  test("falls back to 500 when a ProblemDetails status cannot be converted to http4s"):
    assertEquals(HttpProblemResponse.statusFrom(999), Status.InternalServerError)
