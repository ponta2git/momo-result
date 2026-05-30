package momo.api.http

import munit.FunSuite

final class MaxBodySizeMiddlewareSpec extends FunSuite:
  test("wouldExceedLimit rejects chunks without overflowing near Long.MaxValue") {
    assert(MaxBodySizeMiddleware.wouldExceedLimit(Long.MaxValue - 1L, 2L, Long.MaxValue))
  }

  test("wouldExceedLimit allows chunks that exactly reach the limit") {
    assert(!MaxBodySizeMiddleware.wouldExceedLimit(1L, 2L, 3L))
  }
