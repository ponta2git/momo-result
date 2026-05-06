package momo.api.http

import cats.effect.IO
import io.circe.{Decoder, Json}
import munit.Assertions.*
import org.http4s.circe.*
import org.http4s.{Response, Status}
import org.typelevel.ci.CIString

object HttpAssertions:
  def assertProblem(
      response: Response[IO],
      expectedStatus: Status,
      expectedCode: String,
      detailContains: String,
  ): IO[Unit] = response.as[Json].map { body =>
    assertEquals(response.status, expectedStatus)
    assertEquals(body.hcursor.get[Int]("status"), Right(expectedStatus.code))
    assertEquals(body.hcursor.get[String]("code"), Right(expectedCode))
    assert(
      body.hcursor.get[String]("detail").exists(_.contains(detailContains)),
      s"expected problem detail to contain '$detailContains', got: ${body.noSpaces}",
    )
  }

  def jsonField[A: Decoder](body: Json, field: String): A = body.hcursor.get[A](field).fold(
    error => fail(s"expected JSON field '$field': ${error.getMessage}; body=${body.noSpaces}"),
    identity,
  )

  def optionalHeaderValue(response: Response[IO], name: CIString): Option[String] = response.headers
    .get(name).map(_.head.value)

  def headerValue(response: Response[IO], name: CIString): String =
    optionalHeaderValue(response, name)
      .getOrElse(fail(s"expected header '${name.toString}' on response status=${response.status}"))
