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

  test("recognizes mutating method names from non-http4s request adapters"):
    assert(HttpMethodPredicates.isMutating("POST"))
    assert(HttpMethodPredicates.isMutating("PUT"))
    assert(HttpMethodPredicates.isMutating("PATCH"))
    assert(HttpMethodPredicates.isMutating("DELETE"))
    assert(!HttpMethodPredicates.isMutating("GET"))
