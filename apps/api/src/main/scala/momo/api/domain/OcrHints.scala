package momo.api.domain

final case class PlayerAliasHint(memberId: String, aliases: List[String])

final case class OcrJobHints(
    gameTitle: Option[String],
    layoutFamily: Option[String],
    knownPlayerAliases: List[PlayerAliasHint],
    computerPlayerAliases: List[String],
):
  def isEmpty: Boolean = gameTitle.isEmpty && layoutFamily.isEmpty && knownPlayerAliases.isEmpty &&
    computerPlayerAliases.isEmpty

object OcrJobHints:
  val empty: OcrJobHints = OcrJobHints(
    gameTitle = None,
    layoutFamily = None,
    knownPlayerAliases = Nil,
    computerPlayerAliases = Nil,
  )
