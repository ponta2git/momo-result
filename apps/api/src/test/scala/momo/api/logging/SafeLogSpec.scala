package momo.api.logging

import munit.FunSuite

final class SafeLogSpec extends FunSuite:
  test("throwableClasses records class chain without exception messages"):
    val cause = new IllegalArgumentException("postgres://user:secret@db.example.com/momo")
    val error = new IllegalStateException("secret_table", cause)

    val rendered = SafeLog.throwableClasses(error)

    assertEquals(rendered, "java.lang.IllegalStateException>java.lang.IllegalArgumentException")
    assert(!rendered.contains("secret"))
    assert(!rendered.contains("secret_table"))

end SafeLogSpec
