package momo.api.domain

import io.circe.Codec

final case class PlayerAliasHint(memberId: String, aliases: List[String]) derives Codec.AsObject

final case class OcrJobHints(
    gameTitle: Option[String] = None,
    layoutFamily: Option[String] = None,
    knownPlayerAliases: List[PlayerAliasHint] = Nil,
    computerPlayerAliases: List[String] = Nil,
) derives Codec.AsObject:
  def isEmpty: Boolean = gameTitle.isEmpty && layoutFamily.isEmpty && knownPlayerAliases.isEmpty &&
    computerPlayerAliases.isEmpty
