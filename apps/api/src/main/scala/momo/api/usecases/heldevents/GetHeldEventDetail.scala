package momo.api.usecases.heldevents

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.ids.HeldEventId
import momo.api.domain.{HeldEvent, MatchListItem, MatchRecord}
import momo.api.errors.AppError
import momo.api.repositories.{HeldEventsRepository, MatchListReadModel, MatchesRepository}

final case class HeldEventDetail(
    event: HeldEvent,
    matches: List[MatchRecord],
    drafts: List[MatchListItem],
    nextMatchNo: Int,
)

final class GetHeldEventDetail[F[_]: Monad](
    events: HeldEventsRepository[F],
    matches: MatchesRepository[F],
    matchList: MatchListReadModel[F],
):
  def run(heldEventId: HeldEventId): F[Either[AppError, HeldEventDetail]] = events
    .find(heldEventId).flatMap {
      case None =>
        AppError.NotFound("held event", heldEventId.value).asLeft[HeldEventDetail].pure[F]
      case Some(event) =>
        for
          confirmed <- matches.listByHeldEvent(heldEventId)
          drafts <- matchList.listDraftsByHeldEvent(heldEventId)
        yield
          val maxConfirmed = confirmed.map(_.matchNoInEvent.value).maxOption.getOrElse(0)
          val maxDraft = drafts.flatMap(_.matchNoInEvent.map(_.value)).maxOption.getOrElse(0)
          HeldEventDetail(
            event = event,
            matches = confirmed.sortBy(_.matchNoInEvent.value),
            drafts = drafts,
            nextMatchNo = math.max(maxConfirmed, maxDraft) + 1,
          ).asRight[AppError]
    }
