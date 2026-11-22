package momo.api.config

import java.nio.charset.StandardCharsets
import java.security.MessageDigest

import cats.effect.Sync
import cats.syntax.all.*
import com.comcast.ip4s.{IpAddress, Ipv6Address, Port}

final class WorkerWakeConfig private (
    val host: IpAddress,
    val port: Port,
    private[api] val token: String,
):
  private val expected = token.getBytes(StandardCharsets.US_ASCII)

  def accepts(value: String): Boolean =
    MessageDigest.isEqual(expected, value.getBytes(StandardCharsets.UTF_8))

  override def toString: String = "WorkerWakeConfig([REDACTED])"

object WorkerWakeConfig:
  private[api] def load[F[_]: Sync](
      env: Map[String, String],
      appEnv: AppEnv,
  ): F[Option[WorkerWakeConfig]] =
    val onFly = env.contains("FLY_MACHINE_ID") || env.contains("FLY_APP_NAME")
    if !onFly && appEnv != AppEnv.Prod && !env.keys.exists(_.startsWith("WORKER_WAKE_")) then
      none[WorkerWakeConfig].pure[F]
    else
      val parsed =
        for
          token <- env.get("WORKER_WAKE_TOKEN")
            .filter(t => t.length >= 32 && t.forall(c => c >= '!' && c <= '~'))
            .toRight("WORKER_WAKE_TOKEN requires at least 32 visible ASCII characters.")
          _ <- Either.cond(
            !onFly || env.get("FLY_MACHINE_ID").exists { id =>
              id.nonEmpty &&
              env.get("WORKER_WAKE_WRITER_IDS").exists(_.split(",").map(_.trim).contains(id))
            },
            (),
            "The API Machine is missing from WORKER_WAKE_WRITER_IDS."
          )
          host <- if onFly then
            env.get("FLY_PRIVATE_IP").flatMap(Ipv6Address.fromString)
              .filter(_.toString.startsWith("fd")).toRight(
                "FLY_PRIVATE_IP must be a private IPv6 address."
              )
          else
            IpAddress.fromString(env.getOrElse("WORKER_WAKE_BIND_HOST", "127.0.0.1"))
              .toRight("Invalid WORKER_WAKE_BIND_HOST.")
          port <- env.getOrElse("WORKER_WAKE_PORT", "9091").toIntOption.filter(_ > 0)
            .flatMap(Port.fromInt).toRight("Invalid WORKER_WAKE_PORT.")
        yield new WorkerWakeConfig(host, port, token)
      parsed.leftMap(new IllegalArgumentException(_)).liftTo[F].map(Some(_))
