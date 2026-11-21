package momo.api.usecases.heldevents

import cats.Functor
import cats.syntax.all.*

import momo.api.domain.ids.HeldEventId
import momo.api.domain.{
  HeldEventDetail,
  HeldEventIdentity,
  HeldEventRecordContext,
  HeldEventSummary,
  PublicId
}
import momo.api.errors.AppError
import momo.api.repositories.HeldEventDetailReadModel

final class GetHeldEventDetail[F[_]: Functor](details: HeldEventDetailReadModel[F]):
  def run(heldEventId: HeldEventId): F[Either[AppError, HeldEventDetail]] =
    details.find(heldEventId)
      .map(_.toRight(AppError.NotFound("held event", heldEventId.value)))

  def byPublicId(publicId: PublicId): F[Either[AppError, HeldEventDetail]] =
    details.findByPublicId(publicId)
      .map(_.toRight(AppError.NotFound("held event", publicId.decimalString)))

  def summary(heldEventId: HeldEventId): F[Either[AppError, HeldEventSummary]] =
    details.summary(heldEventId)
      .map(_.toRight(AppError.NotFound("held event", heldEventId.value)))

  def latest: F[Either[AppError, Option[HeldEventIdentity]]] =
    details.latest.map(_.asRight[AppError])

  def recordContext(heldEventId: HeldEventId): F[Either[AppError, HeldEventRecordContext]] =
    details.recordContext(heldEventId).map(_.toRight(AppError.NotFound(
      "held event",
      heldEventId.value
    )))
