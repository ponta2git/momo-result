package momo.api.domain

import munit.FunSuite

final class MatchNoteSpec extends FunSuite:
  test("normalizes line endings and counts Unicode code points"):
    val value = ("🍑" * 149) + "\r\n"
    val result = MatchNoteBody.fromRequiredString(value)
    assertEquals(result.map(_.value), Right(("🍑" * 149) + "\n"))

  test("rejects more than 150 Unicode code points"):
    val result = MatchNoteBody.fromRequiredString("🍑" * 151)
    assert(result.isLeft)

  test("treats Unicode space-only input as absence"):
    assertEquals(MatchNoteBody.fromString("\u00a0\u3000\n"), Right(None))
