package momo.api.adapters.postgres

import java.util.UUID

import scala.concurrent.duration.*

import cats.effect.syntax.all.*
import cats.effect.{Async, Resource}
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import org.typelevel.log4cats.LoggerFactory

import momo.api.logging.SafeLog

private[api] object PostgresSeriesAnalysisReaderCapability:
  // Keep this below the worker release gate's capability freshness window, including one retry.
  // This advertises reader compatibility; it is independent of an active job's lease heartbeat.
  private val HeartbeatInterval = 60.seconds

  def resource[F[_]: Async: LoggerFactory](transactor: Transactor[F]): Resource[F, Unit] =
    Resource.eval(Async[F].delay(SeriesAnalysisPayloadValidator.ensureReady())) *>
      Resource.eval(Async[F].delay(UUID.randomUUID().toString)).flatMap { readerId =>
        Resource.make(
          register(readerId, transactor) >> heartbeatLoop(readerId, transactor).start
        )(fiber => fiber.cancel >> markDraining(readerId, transactor)).void
      }

  private def heartbeatLoop[F[_]: Async: LoggerFactory](
      readerId: String,
      transactor: Transactor[F],
  ): F[Unit] =
    val logger = LoggerFactory[F].getLogger
    (Async[F].sleep(HeartbeatInterval) >> register(readerId, transactor)
      .handleErrorWith(error =>
        logger.error(
          s"series analysis reader heartbeat failed errorClasses=${SafeLog.throwableClasses(error)}"
        )
      ))
      .foreverM

  private def register[F[_]: Async](readerId: String, transactor: Transactor[F]): F[Unit] =
    val schemas = SeriesAnalysisArtifactSupport.ReadableContracts.map(_._1).mkString(
      "[",
      ",",
      "]",
    )
    val validationContracts = io.circe.Json
      .fromValues(
        SeriesAnalysisArtifactSupport.ReadableContracts.map(_._2).map(
          io.circe.Json.fromString
        )
      )
      .noSpaces
    sql"""
      INSERT INTO series_analysis_reader_capabilities (
        reader_id, artifact_schema_versions, validation_contract_ids,
        draining, started_at, heartbeat_at
      ) VALUES (
        $readerId, CAST($schemas AS jsonb), CAST($validationContracts AS jsonb),
        false, clock_timestamp(), clock_timestamp()
      )
      ON CONFLICT (reader_id) DO UPDATE SET
        artifact_schema_versions = EXCLUDED.artifact_schema_versions,
        validation_contract_ids = EXCLUDED.validation_contract_ids,
        draining = false,
        heartbeat_at = clock_timestamp()
    """.update.run.void.transact(transactor)

  private def markDraining[F[_]: Async](
      readerId: String,
      transactor: Transactor[F],
  ): F[Unit] = sql"""
    UPDATE series_analysis_reader_capabilities
    SET draining = true, heartbeat_at = clock_timestamp()
    WHERE reader_id = $readerId
  """.update.run.void.transact(transactor)
