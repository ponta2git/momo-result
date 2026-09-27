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

  test("throwableClasses terminates for cyclic and excessively deep cause chains"):
    val first = new IllegalStateException("sensitive first detail")
    val second = new IllegalArgumentException("sensitive second detail", first)
    val _ = first.initCause(second)
    assertEquals(
      SafeLog.throwableClasses(first),
      "java.lang.IllegalStateException>java.lang.IllegalArgumentException",
    )
    val deep = (1 to 1000).foldLeft[Throwable](new RuntimeException("sensitive leaf")) {
      (cause, _) => new RuntimeException("sensitive outer", cause)
    }
    val rendered = SafeLog.throwableClasses(deep)
    assert(rendered.length < 2048)
    assert(!rendered.contains("sensitive"))

end SafeLogSpec
