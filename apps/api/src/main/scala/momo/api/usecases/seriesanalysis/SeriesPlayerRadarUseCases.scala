package momo.api.usecases.seriesanalysis

import java.nio.charset.StandardCharsets
import java.security.MessageDigest

import momo.api.domain.*
import momo.api.domain.ids.{AccountId, GameTitleId}
import momo.api.errors.AppError
import momo.api.repositories.SeriesPlayerRadarRepository

final class GetSeriesPlayerRadarState[F[_]](repository: SeriesPlayerRadarRepository[F]):
  def run(gameTitleId: GameTitleId): F[Either[AppError, SeriesPlayerRadarDocument]] =
    repository.radarState(gameTitleId)

final class GetSeriesPlayerRadarPreview[F[_]](repository: SeriesPlayerRadarRepository[F]):
  def run(request: SeriesPlayerRadarPreviewRequest)
      : F[Either[AppError, SeriesPlayerRadarDocument]] =
    repository.radarPreview(request)

final class GetSeriesPlayerRadarOperation[F[_]](repository: SeriesPlayerRadarRepository[F]):
  def run(
      gameTitleId: GameTitleId,
      operationId: String,
  ): F[Either[AppError, SeriesPlayerRadarOperation]] =
    repository.radarOperation(gameTitleId, operationId)

final class RequestSeriesPlayerRadarOperation[F[_]](repository: SeriesPlayerRadarRepository[F]):
  def run(
      command: SeriesPlayerRadarCommand,
      requestedBy: AccountId,
      idempotencyKey: String,
  ): F[Either[AppError, SeriesPlayerRadarOperation]] = repository.requestRadarOperation(
    command,
    requestedBy,
    sha256(idempotencyKey),
    fingerprint(command),
  )

  private def fingerprint(command: SeriesPlayerRadarCommand): String =
    val fields = List(
      Some(command.gameTitleId.value),
      Some(command.kind.wire),
      command.candidateId,
      command.previewId,
      command.expectedCurrentBasisId,
      command.originOperationId,
      command.evidenceKey,
    )
    sha256(fields.map(_.fold("-")(value => s"${value.length}:$value")).mkString("|"))

  private def sha256(value: String): String = MessageDigest.getInstance("SHA-256")
    .digest(value.getBytes(StandardCharsets.UTF_8)).map(byte => f"${byte & 0xff}%02x").mkString
