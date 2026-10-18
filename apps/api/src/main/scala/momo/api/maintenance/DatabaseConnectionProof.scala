package momo.api.maintenance

import java.net.URI
import java.util.Locale

import cats.syntax.all.*
import io.circe.Json

import momo.api.util.Sha256

/** Shareable identity of the actual database and complete ordered migration ledger. */
private[api] final case class DatabaseConnectionProof private (
    targetFingerprint: String,
    ledgerFingerprint: String,
) derives CanEqual:
  def toJson: Json = Json.obj(
    "formatVersion" -> Json.fromInt(1),
    "targetFingerprint" -> Json.fromString(targetFingerprint),
    "ledgerFingerprint" -> Json.fromString(ledgerFingerprint),
  )

private[api] object DatabaseConnectionProof:
  final case class LedgerRow(hash: String, createdAt: String)

  def fromSnapshot(
      configuredUrl: String,
      database: String,
      ledger: List[LedgerRow],
  ): Either[Throwable, DatabaseConnectionProof] =
    for
      uri <- Either.catchNonFatal(URI.create(configuredUrl.stripPrefix("jdbc:")))
        .leftMap(_ => invalidConfiguration)
      host <- Option(uri.getHost).filter(_.nonEmpty).toRight(invalidConfiguration)
      _ <- Either.cond(
        Set("postgres", "postgresql").contains(uri.getScheme) && database.nonEmpty &&
          (uri.getPort == -1 || (uri.getPort > 0 && uri.getPort <= 65535)),
        (),
        invalidConfiguration,
      )
      _ <- Either.cond(
        ledger.nonEmpty && ledger.forall(row =>
          row.hash.matches("[a-f0-9]{64}") && row.createdAt.matches("[0-9]+")
        ),
        (),
        new IllegalStateException("Invalid database proof ledger."),
      )
      lowerHost = host.toLowerCase(Locale.ROOT)
      canonicalHost = if lowerHost.endsWith(".neon.tech") then
        lowerHost.replaceFirst("^([^.]+)-pooler\\.", "$1.")
      else lowerHost
      port = if uri.getPort == -1 then "5432" else uri.getPort.toString
      target = Json.arr(
        List("momo-database-target-v1", canonicalHost, port, database).map(Json.fromString)*
      ).noSpaces
      history = "momo-drizzle-ledger-v1\n" +
        ledger.map(row => s"${row.hash}:${row.createdAt}\n").mkString
    yield DatabaseConnectionProof(Sha256.hexUtf8(target), Sha256.hexUtf8(history))

  private def invalidConfiguration: IllegalArgumentException =
    new IllegalArgumentException("Invalid database proof configuration.")
