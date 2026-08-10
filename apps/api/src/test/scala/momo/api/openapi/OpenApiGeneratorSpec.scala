package momo.api.openapi

import munit.FunSuite

final class OpenApiGeneratorSpec extends FunSuite:
  test("generated contract has no trailing whitespace") {
    val linesWithTrailingWhitespace = OpenApiGenerator.yaml.linesIterator.filter(line =>
      line.lastOption.exists(_.isWhitespace)
    ).toList

    assertEquals(linesWithTrailingWhitespace, Nil)
  }
