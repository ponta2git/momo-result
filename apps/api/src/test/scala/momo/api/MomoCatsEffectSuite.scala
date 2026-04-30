package momo.api

import munit.CatsEffectSuite
import scala.concurrent.duration.DurationInt

abstract class MomoCatsEffectSuite extends CatsEffectSuite:
  override def munitIOTimeout = 30.seconds
