package momo.api.http

import munit.FunSuite
import org.http4s.Method

final class HttpMethodPredicatesSpec extends FunSuite:
  test("classifies only write methods as mutating"):
    assert(HttpMethodPredicates.isMutating(Method.POST))
    assert(HttpMethodPredicates.isMutating(Method.PUT))
    assert(HttpMethodPredicates.isMutating(Method.PATCH))
    assert(HttpMethodPredicates.isMutating(Method.DELETE))
    assert(!HttpMethodPredicates.isMutating(Method.GET))
    assert(!HttpMethodPredicates.isMutating(Method.HEAD))
