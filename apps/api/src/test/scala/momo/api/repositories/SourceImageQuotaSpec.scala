package momo.api.repositories

import munit.FunSuite

final class SourceImageQuotaSpec extends FunSuite:
  test("quota accepts exact limits and rejects count before bytes"):
    val quota = SourceImageQuota(3, 100)
    assertEquals(quota.evaluate(2, 90, 10), None)
    assertEquals(quota.evaluate(3, 100, 10), Some(SourceImageQuotaRejection.CountExceeded(4, 3)))
    assertEquals(quota.evaluate(2, 91, 10), Some(SourceImageQuotaRejection.BytesExceeded(101, 100)))

  test("overflow cannot turn usage into available capacity"):
    val quota = SourceImageQuota(Int.MaxValue, Long.MaxValue - 1)
    assertEquals(
      quota.evaluate(0, Long.MaxValue - 2, 10),
      Some(SourceImageQuotaRejection.BytesExceeded(Long.MaxValue, Long.MaxValue - 1))
    )
    assertEquals(
      quota.evaluate(Long.MaxValue, 0, 0),
      Some(SourceImageQuotaRejection.CountExceeded(Long.MaxValue, Int.MaxValue))
    )
