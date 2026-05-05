package momo.api.domain

final case class PlayerAliasHint(memberId: String, aliases: List[String])

final case class OcrJobHints(
    gameTitle: Option[String] = None,
    layoutFamily: Option[String] = None,
    knownPlayerAliases: List[PlayerAliasHint] = Nil,
    computerPlayerAliases: List[String] = Nil,
):
  def isEmpty: Boolean = gameTitle.isEmpty && layoutFamily.isEmpty && knownPlayerAliases.isEmpty &&
    computerPlayerAliases.isEmpty
