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
  val MaxGameTitleLength = 64
  val MaxLayoutFamilyLength = 64
  val MaxKnownPlayerAliases = 4
  val MaxMemberIdLength = 128
  val MaxAliasesPerPlayer = 8
  val MaxAliasLength = 64
  val MaxComputerPlayerAliases = 8

  val empty: OcrJobHints = OcrJobHints(
    gameTitle = None,
    layoutFamily = None,
    knownPlayerAliases = Nil,
    computerPlayerAliases = Nil,
  )

  def validationErrors(hints: OcrJobHints): List[String] =
    val errors = List.newBuilder[String]

    def validateText(field: String, value: String, maxLength: Int): Unit =
      if value.isEmpty then errors += s"$field must be non-empty."
      else if value.length > maxLength then
        errors += s"$field must be at most $maxLength characters."

    hints.gameTitle.foreach(validateText("ocrHints.gameTitle", _, MaxGameTitleLength))
    hints.layoutFamily.foreach(validateText("ocrHints.layoutFamily", _, MaxLayoutFamilyLength))

    if hints.knownPlayerAliases.length > MaxKnownPlayerAliases then
      errors += s"ocrHints.knownPlayerAliases must contain at most $MaxKnownPlayerAliases items."

    hints.knownPlayerAliases.zipWithIndex.foreach { case (hint, index) =>
      validateText(
        s"ocrHints.knownPlayerAliases[$index].memberId",
        hint.memberId,
        MaxMemberIdLength,
      )
      if hint.aliases.isEmpty then
        errors += s"ocrHints.knownPlayerAliases[$index].aliases must contain at least 1 item."
      if hint.aliases.length > MaxAliasesPerPlayer then
        errors +=
          s"ocrHints.knownPlayerAliases[$index].aliases must contain at most $MaxAliasesPerPlayer items."
      hint.aliases.zipWithIndex.foreach { case (alias, aliasIndex) =>
        validateText(
          s"ocrHints.knownPlayerAliases[$index].aliases[$aliasIndex]",
          alias,
          MaxAliasLength,
        )
      }
    }

    if hints.computerPlayerAliases.length > MaxComputerPlayerAliases then
      errors +=
        s"ocrHints.computerPlayerAliases must contain at most $MaxComputerPlayerAliases items."
    hints.computerPlayerAliases.zipWithIndex.foreach { case (alias, index) =>
      validateText(s"ocrHints.computerPlayerAliases[$index]", alias, MaxAliasLength)
    }

    errors.result()
