package momo.api.usecases.seriesanalysis

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.*
import momo.api.domain.ids.{AccountId, GameTitleId}
import momo.api.errors.AppError
import momo.api.repositories.SeriesPlayerRadarRepository
import momo.api.util.Sha256

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

final class GetSeriesPlayerRadarHistory[F[_]](repository: SeriesPlayerRadarRepository[F]):
  def list(request: SeriesPlayerRadarHistoryRequest)
      : F[Either[AppError, SeriesPlayerRadarDocument]] =
    repository.radarHistory(request)
  def detail(revisionId: String): F[Either[AppError, SeriesPlayerRadarDocument]] =
    repository.radarRevision(revisionId)

final class RequestSeriesPlayerRadarOperation[F[_]: Monad](
    repository: SeriesPlayerRadarRepository[F]
):
  def run(
      command: SeriesPlayerRadarCommand,
      requestedBy: AccountId,
      idempotencyKey: String,
  ): F[Either[AppError, SeriesPlayerRadarOperation]] = command.validated match
    case Left(error) => error.asLeft[SeriesPlayerRadarOperation].pure[F]
    case Right(validated) => repository.requestRadarOperation(
        validated,
        requestedBy,
        Sha256.hexUtf8(idempotencyKey),
        fingerprint(validated),
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
    ) ++
      (if command.kind == SeriesPlayerRadarOperationKind.Manual then
         List(
           command.expectedCandidateId,
           command.sourceBasisId,
           command.sourceCandidateId,
           command.manualInput.map(_.axes.map(axis =>
             axis.axisId + ":" + axis.thresholds.map(java.lang.Double.toHexString).mkString(",")
           ).mkString("|")),
         )
       else Nil)
    Sha256.hexUtf8(fields.map(_.fold("-")(value => s"${value.length}:$value")).mkString("|"))
