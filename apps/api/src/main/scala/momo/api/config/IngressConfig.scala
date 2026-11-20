package momo.api.config

import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.Locale

import cats.effect.Sync
import cats.syntax.all.*

/** The authenticated edge is the only source of forwarded client identity. */
final class IngressConfig private (
    val allowedHosts: Set[String],
    private val tokenBytes: Array[Byte],
):
  def acceptsToken(value: String): Boolean =
    MessageDigest.isEqual(tokenBytes, value.getBytes(StandardCharsets.UTF_8))

  override def toString: String = "IngressConfig(hosts=[REDACTED], token=[REDACTED])"

object IngressConfig:
  private val HostLabel = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?".r

  private[api] def load[F[_]: Sync](
      env: Map[String, String],
      appEnv: AppEnv,
  ): F[Option[IngressConfig]] =
    val configured =
      List("MOMO_ORIGIN_LOCK_TOKEN", "MOMO_CANONICAL_HOST", "MOMO_EXTRA_ALLOWED_HOSTS")
        .exists(env.contains)
    if appEnv != AppEnv.Prod && !configured then none[IngressConfig].pure[F]
    else
      val token = env.getOrElse("MOMO_ORIGIN_LOCK_TOKEN", "")
      val canonical = env.getOrElse("MOMO_CANONICAL_HOST", "")
      val hosts = (canonical :: env.getOrElse("MOMO_EXTRA_ALLOWED_HOSTS", "").split(",").toList)
        .map(normalizeHost).filter(_.nonEmpty).toSet
      val validToken = token.length >= 32 &&
        token.forall(character => character >= '!' && character <= '~')
      if !validToken then
        new IllegalArgumentException(
          "MOMO_ORIGIN_LOCK_TOKEN must contain at least 32 visible ASCII characters."
        )
          .raiseError[F, Option[IngressConfig]]
      else if normalizeHost(canonical).isEmpty || !hosts.forall(validHost) then
        new IllegalArgumentException(
          "MOMO_CANONICAL_HOST and MOMO_EXTRA_ALLOWED_HOSTS must contain valid hostnames."
        )
          .raiseError[F, Option[IngressConfig]]
      else Some(new IngressConfig(hosts, token.getBytes(StandardCharsets.UTF_8))).pure[F]

  def normalizeHost(value: String): String = value.trim.toLowerCase(Locale.ROOT).stripSuffix(".")

  private def validHost(value: String): Boolean =
    value.length <= 253 && value.split("\\.", -1).forall(HostLabel.matches)
