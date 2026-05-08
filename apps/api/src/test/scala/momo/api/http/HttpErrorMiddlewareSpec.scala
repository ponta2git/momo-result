package momo.api.http

import java.sql.SQLException

import cats.effect.IO
import io.circe.parser.parse
import org.http4s.{HttpRoutes, Request, Status, Uri}

import momo.api.MomoCatsEffectSuite

final class HttpErrorMiddlewareSpec extends MomoCatsEffectSuite:
  test("maps database exceptions to sanitized dependency ProblemDetails") {
    val app = HttpErrorMiddleware[IO](HttpRoutes.of[IO] {
      case _ => IO.raiseError(new SQLException("relation secret_table missing"))
    }.orNotFound)

    for
      response <- app.run(Request[IO](uri = Uri.unsafeFromString("/boom")))
      body <- response.as[String]
      json <- IO.fromEither(parse(body))
    yield
      assertEquals(response.status, Status.ServiceUnavailable)
      assertEquals(json.hcursor.get[String]("code"), Right("DEPENDENCY_FAILED"))
      assertEquals(json.hcursor.get[String]("detail"), Right("Database operation failed."))
      assert(!body.contains("secret_table"))
  }
