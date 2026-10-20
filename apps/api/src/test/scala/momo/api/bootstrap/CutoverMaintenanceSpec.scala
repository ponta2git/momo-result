package momo.api.bootstrap

import munit.FunSuite

final class CutoverMaintenanceSpec extends FunSuite:
  test("only an absent configuration permits ordinary application wiring") {
    assertEquals(CutoverMaintenance.enabled(Map.empty).toOption, Some(false))
    assertEquals(
      CutoverMaintenance.enabled(Map("MOMO_CUTOVER_MODE" -> "maintenance")).toOption,
      Some(true)
    )
    List("", "false", "active", "maintenence").foreach { value =>
      assert(CutoverMaintenance.enabled(Map("MOMO_CUTOVER_MODE" -> value)).isLeft)
    }
    assert(CutoverMaintenance.enabled(Map("MOMO_CUTOVER_IMAGE_DIGEST" -> "stale")).isLeft)
  }
