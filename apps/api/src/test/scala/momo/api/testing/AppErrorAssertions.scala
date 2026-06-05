package momo.api.testing

import cats.effect.IO
import munit.Assertions.*

import momo.api.errors.{AppError, AppException}

object AppErrorAssertions:
  def assertRight[A](result: Either[AppError, A]): A = result match
    case Right(value) => value
    case Left(error) => fail(s"expected success, got: $error")

  def fromAppEither[A](value: Either[AppError, A]): IO[A] = value match
    case Right(result) => IO.pure(result)
    case Left(error) => IO.raiseError(new RuntimeException(error.detail))

  def assertAppError[A](
      result: Either[AppError, A],
      expectedCode: String,
      detailContains: String,
  ): Unit = result match
    case Left(error) =>
      assertEquals(error.code, expectedCode)
      assert(error.detail.contains(detailContains), s"unexpected detail: ${error.detail}")
    case Right(value) => fail(s"expected $expectedCode, got success: $value")

  def assertAppException[A](
      result: Either[Throwable, A],
      expected: AppError,
  ): Unit = result match
    case Left(error: AppException) =>
      assertEquals(error.error, expected)
    case other => fail(s"expected AppException($expected), got $other")

  def assertAppException[A](
      result: Either[Throwable, A],
      expectedCode: String,
      detailContains: String,
  ): Unit = result match
    case Left(error: AppException) =>
      assertEquals(error.error.code, expectedCode)
      assert(
        error.error.detail.contains(detailContains),
        s"unexpected detail: ${error.error.detail}",
      )
    case Left(error) => fail(s"expected AppException($expectedCode), got $error")
    case Right(value) => fail(s"expected AppException($expectedCode), got success: $value")
