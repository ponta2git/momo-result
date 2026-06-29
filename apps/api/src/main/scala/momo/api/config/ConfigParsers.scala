package momo.api.config

import ciris.{ConfigKey, ConfigValue, Effect}
import io.github.iltotore.iron.*
import io.github.iltotore.iron.ciris.given
import io.github.iltotore.iron.constraint.all.*

import momo.api.domain.constraints.RefinedTypes.{
  NonNegative,
  NonNegativeInt,
  PortNumber,
  PortRange,
  PositiveInt,
  PositiveLong
}

private[config] object ConfigParsers:
  type PercentRange = GreaterEqual[1] & LessEqual[100]
  type PercentInt = Int :| PercentRange

  private[config] def parsePositiveInt(
      env: Map[String, String],
      name: String,
      default: Int,
  ): ConfigValue[Effect, Int] =
    envValue(env, name).as[PositiveInt].default(default.refineUnsafe[Positive]).map(value => value)

  private[config] def parseNonNegativeInt(
      env: Map[String, String],
      name: String,
      default: Int,
  ): ConfigValue[Effect, Int] =
    envValue(env, name).as[NonNegativeInt].default(default.refineUnsafe[NonNegative])
      .map(value => value)

  private[config] def parsePositiveLong(
      env: Map[String, String],
      name: String,
      default: Long,
  ): ConfigValue[Effect, Long] =
    envValue(env, name).as[PositiveLong].default(default.refineUnsafe[Positive])
      .map(value => value)

  private[config] def parsePort(
      env: Map[String, String],
      name: String,
      default: Int,
  ): ConfigValue[Effect, Int] =
    envValue(env, name).as[PortNumber].default(default.refineUnsafe[PortRange])
      .map(value => value)

  private[config] def parsePercent(
      env: Map[String, String],
      name: String,
      default: Int,
  ): ConfigValue[Effect, Int] =
    envValue(env, name).as[PercentInt].default(default.refineUnsafe[PercentRange])
      .map(value => value)

  private[config] def parseBoolean(
      env: Map[String, String],
      name: String,
      default: Boolean,
  ): ConfigValue[Effect, Boolean] = envValue(env, name).as[Boolean].default(default)

  private[config] def envOrDefault(
      env: Map[String, String],
      name: String,
      default: String
  ): ConfigValue[Effect, String] = envValue(env, name).default(default)

  private[config] def envValue(
      env: Map[String, String],
      name: String,
  ): ConfigValue[Effect, String] = ConfigValue.suspend {
    val key = ConfigKey.env(name)
    env.get(name).map(_.trim).filter(_.nonEmpty) match
      case Some(value) => ConfigValue.loaded(key, value)
      case None => ConfigValue.missing(key)
  }
