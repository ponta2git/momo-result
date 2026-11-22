package momo.api.adapters.postgres

import java.net.{InetAddress, InetSocketAddress, StandardProtocolFamily}
import java.nio.channels.ServerSocketChannel
import java.nio.charset.StandardCharsets
import java.util.UUID

import cats.data.Kleisli
import cats.effect.syntax.all.*
import cats.effect.{Async, Ref, Resource}
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import org.http4s.{HttpApp, Response, Status}

import momo.api.contracts.seriesanalysis.SeriesAnalysisArtifactContract

private[api] object PostgresSeriesAnalysisReaderCapability:
  // The machine-local release command uses this socket to challenge the running JVM.
  private val AttestationPort = 19371
  private val Challenge = "momo-release-attest-v1\n".getBytes(StandardCharsets.US_ASCII)

  final class ReaderAdmission[F[_]: Async] private[PostgresSeriesAnalysisReaderCapability] (
      admitted: Ref[F, Boolean],
      val attest: F[String],
  ):
    def guard(app: HttpApp[F]): HttpApp[F] = Kleisli { request =>
      if request.uri.path.renderString == "/healthz" then app.run(request)
      else
        admitted.get.flatMap {
          case true => app.run(request)
          case false => Async[F].pure(Response[F](Status.ServiceUnavailable))
        }
    }

  def resource[F[_]: Async](transactor: Transactor[F]): Resource[F, ReaderAdmission[F]] =
    for
      _ <- Resource.eval(Async[F].delay(SeriesAnalysisPayloadValidator.ensureReady()))
      readerId <- Resource.eval(Async[F].delay(UUID.randomUUID().toString))
      admitted <- Resource.eval(Ref.of[F, Boolean](false))
      attest = register(readerId, transactor).flatMap(admitted.set)
      admission = ReaderAdmission(admitted, attest.as(readerId))
      _ <- Resource.make(admission.attest)(_ => markDraining(readerId, transactor))
      hosted <- Resource.eval(Async[F].delay(sys.env.contains("FLY_MACHINE_ID") ||
        sys.env.get("MOMO_ANALYSIS_RELEASE_ATTESTATION").contains("enabled")))
      _ <- if hosted then releaseProbe(admission.attest) else Resource.unit[F]
    yield admission

  private def releaseProbe[F[_]: Async](attest: F[String]): Resource[F, Unit] =
    Resource.fromAutoCloseable(
      Async[F].blocking(ServerSocketChannel.open(StandardProtocolFamily.INET))
    )
      .evalTap(channel =>
        Async[F].blocking {
          channel.bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), AttestationPort))
          ()
        }
      ).flatMap { server =>
        val serve = Resource.fromAutoCloseable(Async[F].interruptibleMany(server.accept()))
          .use { channel =>
            val socket = channel.socket()
            Async[F].blocking {
              socket.setSoTimeout(1000)
              java.util.Arrays.equals(socket.getInputStream.readNBytes(Challenge.length), Challenge)
            }.flatMap { valid =>
              if valid then
                attest.flatMap { readerId =>
                  Async[F].blocking {
                    socket.getOutputStream.write(
                      (readerId + "\n").getBytes(StandardCharsets.US_ASCII)
                    )
                  }
                }
              else Async[F].unit
            }.handleError(_ => ())
          }
        // A failed challenge returns no evidence. The next maintenance attempt can retry it.
        serve.foreverM[Unit].background.void
      }

  private def register[F[_]: Async](readerId: String, transactor: Transactor[F]): F[Boolean] =
    val schema = SeriesAnalysisArtifactContract.ArtifactSchemaVersion
    val contract = SeriesAnalysisArtifactContract.ValidationContractId
    val schemas = io.circe.Json.arr(io.circe.Json.fromInt(schema)).noSpaces
    val contracts = io.circe.Json.arr(io.circe.Json.fromString(contract)).noSpaces
    // Take the registry's row-exclusive lock before the singleton, as promotion does. A
    // candidate can attest before promotion, but cannot serve until its DB contract is active.
    (sql"""
      INSERT INTO series_analysis_reader_capabilities (
        reader_id, artifact_schema_versions, validation_contract_ids, draining, started_at, heartbeat_at
      ) VALUES ($readerId, CAST($schemas AS jsonb), CAST($contracts AS jsonb), false, clock_timestamp(), clock_timestamp())
      ON CONFLICT (reader_id) DO UPDATE SET artifact_schema_versions = EXCLUDED.artifact_schema_versions,
        validation_contract_ids = EXCLUDED.validation_contract_ids, heartbeat_at = clock_timestamp(), draining = false
    """.update.run *>
      sql"""
      SELECT artifact_schema_version = $schema AND validation_contract_id IS NOT DISTINCT FROM $contract
      FROM series_analysis_release_state WHERE singleton_key = 'current' FOR SHARE
    """.query[Boolean].unique).transact(transactor)

  private def markDraining[F[_]: Async](readerId: String, transactor: Transactor[F]): F[Unit] =
    sql"""
    UPDATE series_analysis_reader_capabilities SET draining = true, heartbeat_at = clock_timestamp()
    WHERE reader_id = $readerId
  """.update.run.void.transact(transactor)
