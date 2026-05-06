package momo.api.http

import cats.effect.IO
import io.circe.Json
import munit.Assertions.*
import org.http4s.circe.*
import org.http4s.{Response, Status}

object HttpProblemAssertions:
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
