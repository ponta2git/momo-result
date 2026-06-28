package momo.api.config

private[config] object ConfigParsers:
  private[config] def parsePositiveInt(
      env: Map[String, String],
      name: String,
      default: Int,
  ): Either[Throwable, Int] = parseInt(env, name, default, _ > 0, "positive integer")

  private[config] def parseNonNegativeInt(
      env: Map[String, String],
      name: String,
      default: Int,
  ): Either[Throwable, Int] = parseInt(env, name, default, _ >= 0, "non-negative integer")

  private[config] def parsePositiveLong(
      env: Map[String, String],
      name: String,
      default: Long,
  ): Either[Throwable, Long] = parseLong(env, name, default, _ > 0L, "positive integer")

  private[config] def parsePort(
      env: Map[String, String],
      name: String,
      default: Int,
  ): Either[Throwable, Int] = parseInt(
    env,
    name,
    default,
    value => value > 0 && value <= 65535,
    "TCP port between 1 and 65535",
  )

  private[config] def parsePercent(
      env: Map[String, String],
      name: String,
      default: Int,
  ): Either[Throwable, Int] = parseInt(
    env,
    name,
    default,
    value => value >= 1 && value <= 100,
    "integer percentage between 1 and 100",
  )

  private[config] def parseBoolean(
      env: Map[String, String],
      name: String,
      default: Boolean,
  ): Either[Throwable, Boolean] = env.get(name).filter(_.nonEmpty) match
    case None => Right(default)
    case Some(raw) => raw.toBooleanOption
        .toRight(new IllegalArgumentException(s"$name must be true or false, got: $raw"))

  private def parseInt(
      env: Map[String, String],
      name: String,
      default: Int,
      valid: Int => Boolean,
      description: String,
  ): Either[Throwable, Int] = env.get(name).filter(_.nonEmpty) match
    case None => Right(default)
    case Some(raw) => raw.toIntOption.filter(valid)
        .toRight(new IllegalArgumentException(s"$name must be a $description, got: $raw"))

  private def parseLong(
      env: Map[String, String],
      name: String,
      default: Long,
      valid: Long => Boolean,
      description: String,
  ): Either[Throwable, Long] = env.get(name).filter(_.nonEmpty) match
    case None => Right(default)
    case Some(raw) => raw.toLongOption.filter(valid)
        .toRight(new IllegalArgumentException(s"$name must be a $description, got: $raw"))

  private[config] def envOrDefault(
      env: Map[String, String],
      name: String,
      default: String
  ): String =
    env
      .get(name).map(_.trim).filter(_.nonEmpty).getOrElse(default)
