package momo.api.domain

import momo.api.domain.ids.MemberId

/** Bounded player-alias snapshot fixed when a job is accepted; recognition belongs to the worker. */
object OcrHintEnrichment:
  private val defaultPlayers = List(
    "member_ponta" -> List("ぽんた"),
    "member_akane_mami" -> List("あかねまみ", "NO11"),
    "member_otaka" -> List("おーたか", "オータカ"),
    "member_eu" -> List("いーゆー"),
  ).map { case (id, aliases) => PlayerAliasHint(MemberId.unsafeFromString(id), aliases) }

  def apply(
      hints: OcrJobHints,
      aliasesByMember: Map[MemberId, List[String]],
  ): OcrJobHints =
    val useDefaults = hints.knownPlayerAliases.isEmpty
    val requested = if useDefaults then defaultPlayers else hints.knownPlayerAliases
    val requestedIds = requested.map(_.memberId)
    val additionalIds =
      if useDefaults then Nil
      else aliasesByMember.keys.toList.sortBy(_.value).filterNot(requestedIds.contains)
    val memberIds = (requestedIds ++ additionalIds).distinct.take(OcrJobHints.MaxKnownPlayerAliases)
    // Explicit client hints retain their existing merge semantics, including unmodified hints
    // when no persisted aliases exist. Server defaults normalize OCR's optional title suffix.
    val players =
      if !useDefaults && aliasesByMember.isEmpty then requested
      else
        memberIds.flatMap { memberId =>
          val aliases =
            (requested.find(_.memberId == memberId).fold(Nil)(_.aliases) ++
              aliasesByMember.getOrElse(memberId, Nil)).map { alias =>
              if useDefaults then alias.trim.stripSuffix("社長").trim else alias.trim
            }.filter(_.nonEmpty).distinct.take(OcrJobHints.MaxAliasesPerPlayer)
          Option.when(aliases.nonEmpty)(PlayerAliasHint(memberId, aliases))
        }
    hints.copy(knownPlayerAliases = players)
