package momo.api

import scala.concurrent.duration.DurationInt

import munit.CatsEffectSuite

abstract class MomoCatsEffectSuite extends CatsEffectSuite:
  override def munitIOTimeout = 30.seconds
