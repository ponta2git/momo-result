package momo.api.domain

import munit.FunSuite

final class PublicIdSpec extends FunSuite:
  test("public numbers preserve exact decimal strings through the signed bigint range"):
    List("1", "9007199254740993", "9223372036854775807").foreach { value =>
      assertEquals(PublicId.fromString(value).map(_.decimalString), Right(value))
    }

  test("public numbers reject ambiguous spellings and overflow"):
    List(
      "", "0", "-1", "+1", "01", " 1", "1 ", "1.0", "1e3", "１", "1_000",
      "9223372036854775808", "18446744073709551615",
    ).foreach(value => assert(PublicId.fromString(value).isLeft, value))
