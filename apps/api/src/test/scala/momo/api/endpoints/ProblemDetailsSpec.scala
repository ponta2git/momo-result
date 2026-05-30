package momo.api.endpoints

import munit.FunSuite

import momo.api.errors.AppError

final class ProblemDetailsSpec extends FunSuite:
  test("internal errors expose a generic public detail"):
    val secret = "postgres://user:secret@db.example.com/momo"

    val (_, problem) = ProblemDetails.from(AppError.Internal(s"stored response leaked $secret"))

    assertEquals(problem.code, "INTERNAL_ERROR")
    assertEquals(problem.detail, "Unexpected server error.")
    assert(!problem.detail.contains("secret"))

  test("expected application errors keep their actionable detail"):
    val (_, problem) = ProblemDetails.from(AppError.ValidationFailed("matchNo must be positive."))

    assertEquals(problem.code, "VALIDATION_FAILED")
    assertEquals(problem.detail, "matchNo must be positive.")
