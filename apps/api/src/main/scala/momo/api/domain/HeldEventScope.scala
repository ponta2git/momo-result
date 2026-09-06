package momo.api.domain

import momo.api.domain.ids.{GameTitleId, SeasonMasterId}

/** A title/season pair recorded by a confirmed match or an active draft. */
final case class HeldEventScope(
    gameTitleId: Option[GameTitleId],
    seasonMasterId: Option[SeasonMasterId],
) derives CanEqual:
  def isDefined: Boolean = gameTitleId.nonEmpty || seasonMasterId.nonEmpty
