package momo.api.adapters.inmemory

import cats.Monad
import cats.syntax.all.*

import momo.api.domain.ids.HeldEventId
import momo.api.domain.{HeldEventDetail, HeldEventSummary}
import momo.api.repositories.{HeldEventDetailReadModel, HeldEventsRepository, MatchListReadModel, MatchesRepository}

final class InMemoryHeldEventDetailReadModel[F[_]: Monad](
    events: HeldEventsRepository[F],
    matches: MatchesRepository[F],
    matchList: MatchListReadModel[F],
    metadata: InMemoryMatchMetadata[F],
) extends HeldEventDetailReadModel[F]:
  override def find(id: HeldEventId): F[Option[HeldEventDetail]] = events.find(id).flatMap(_.traverse { event =>
    for
      confirmed <- matches.listByHeldEvent(id)
      drafts <- matchList.listDraftsByHeldEvent(id)
      labels <- confirmed.traverse(m => metadata.labels(Some(m.gameTitleId), Some(m.seasonMasterId), Some(m.mapMasterId)))
    yield HeldEventDetail(
      event,
      confirmed.zip(labels).map { case (m, label) => HeldEventDetail.Match(
        m.id, m.matchNoInEvent, m.gameTitleId, m.seasonMasterId, m.ownerMemberId,
        m.mapMasterId, m.playedAt, m.note.body.map(_.value),
        m.players.byPlayOrder.map(p => HeldEventDetail.Player(
          p.memberId, p.playOrder, p.rank, p.totalAssetsManYen, p.revenueManYen,
        )),
        label,
      ) },
      drafts.flatMap(d => (d.matchDraftId, momo.api.domain.MatchDraftStatus.fromWire(d.status)).mapN { (draftId, status) =>
        HeldEventDetail.Draft(draftId, status, d.matchNoInEvent, d.gameTitleId,
          d.seasonMasterId, d.mapMasterId, d.playedAt, d.updatedAt, d.labels)
      }),
    )
  })

  override def summary(id: HeldEventId): F[Option[HeldEventSummary]] = find(id).map(_.map(detail =>
    HeldEventSummary(detail.event, detail.matches.size, detail.drafts.size, detail.nextMatchNo)
  ))
