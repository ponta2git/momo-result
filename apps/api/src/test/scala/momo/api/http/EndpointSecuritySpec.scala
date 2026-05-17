package momo.api.http

import cats.effect.{IO, Ref}

import momo.api.MomoCatsEffectSuite
import momo.api.auth.AuthenticatedAccount
import momo.api.endpoints.ProblemDetails
import momo.api.errors.AppError

final class EndpointSecuritySpec extends MomoCatsEffectSuite:
  test("logs incident AppErrors returned as endpoint values without leaking details") {
    val secret = "postgres://user:secret@example.com/db"

    for
      captured <- Ref.of[IO, Vector[String]](Vector.empty)
      security = EndpointSecurity[IO](NoopAuthPolicy, error => captured.update(_ :+ error.code))
      _ <- security
        .respond(IO.pure(Left[AppError, Unit](AppError.Internal(s"invalid $secret"))))(identity)
      events <- captured.get
    yield
      assertEquals(events, Vector("INTERNAL_ERROR"))
      assert(!events.mkString("\n").contains(secret))
  }

  test("does not log expected AppErrors returned as endpoint values") {
    for
      captured <- Ref.of[IO, Vector[String]](Vector.empty)
      security = EndpointSecurity[IO](NoopAuthPolicy, error => captured.update(_ :+ error.code))
      _ <- security
        .respond(IO.pure(Left[AppError, Unit](AppError.Conflict("already exists"))))(identity)
      events <- captured.get
    yield assert(events.isEmpty)
  }

  private object NoopAuthPolicy extends AuthPolicy[IO]:
    override def authenticate(
        accountHeader: Option[String]
    ): IO[Either[ProblemDetails.ProblemResponse, AuthenticatedAccount]] = IO
      .pure(Left(ProblemDetails.from(AppError.Unauthorized())))

    override def verifyCsrf(
        csrfToken: Option[String]
    ): IO[Either[ProblemDetails.ProblemResponse, Unit]] = IO
      .pure(Left(ProblemDetails.from(AppError.Unauthorized())))
