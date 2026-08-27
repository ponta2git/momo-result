package momo.api.endpoints

import munit.FunSuite

import momo.api.errors.AppError

final class ProblemDetailsSpec extends FunSuite:
  test("internal errors expose a generic public detail"):
    val secret = "postgres://user:secret@db.example.com/momo"

    val (_, _, problem) = ProblemDetails.from(AppError.Internal(s"stored response leaked $secret"))

    assertEquals(problem.code, "INTERNAL_ERROR")
    assertEquals(problem.detail, "予期しないエラーが発生しました。もう一度お試しください。")
    assert(!problem.detail.contains("secret"))

  test("validation errors do not expose internal field names"):
    val (_, _, problem) =
      ProblemDetails.from(AppError.ValidationFailed("matchNo must be positive."))

    assertEquals(problem.code, "VALIDATION_FAILED")
    assertEquals(problem.detail, "入力内容を確認してください。")
    assert(!problem.detail.contains("matchNo"))

  test("not-found errors do not expose resource names or identifiers"):
    val (_, _, problem) = ProblemDetails.from(AppError.NotFound("match draft", "draft-secret"))

    assertEquals(problem.code, "NOT_FOUND")
    assertEquals(problem.detail, "指定されたデータが見つかりませんでした。")
    assert(!problem.detail.contains("match draft"))
    assert(!problem.detail.contains("draft-secret"))
