package momo.api.domain

import java.time.Instant

import momo.api.domain.ids.{HeldEventId, MatchId}

/** Current display metadata read alongside the records it describes. */
final case class MatchLabels(
    gameTitleName: Option[String],
    seasonName: Option[String],
    mapName: Option[String],
)

object MatchLabels:
  val empty: MatchLabels = MatchLabels(None, None, None)

/** The small identity used to resolve a selected match without loading its results. */
final case class MatchIdentity(
    id: MatchId,
    matchNoInEvent: MatchNoInEvent,
    playedAt: Instant,
    gameTitleName: Option[String],
    seasonName: Option[String],
)

final case class MatchDetail(
    record: MatchRecord,
    noteUpdatedByDisplayName: Option[String],
    navigation: RecordNavigation[AdjacentMatch],
    heldAt: Option[Instant] = None,
    labels: MatchLabels = MatchLabels.empty,
)

final case class AdjacentMatch(
    matchId: MatchId,
    heldEventId: HeldEventId,
    playedAt: Instant,
    heldAt: Instant,
    matchNoInEvent: MatchNoInEvent,
)
