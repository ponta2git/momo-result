package momo.api.adapters.postgres

import java.util.UUID

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.adapters.postgres.PostgresAchievementMatchLocks.MatchSource
import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.errors.{AppError, AppException}

/** Shared transactional writes used by ordinary saves and the one-time initial import. */
private[postgres] object PostgresAchievementWriteOps:
  def reject[A](message: String): ConnectionIO[A] =
    new AppException(AppError.Conflict(message)).raiseError[ConnectionIO, A]

  def ensure(condition: Boolean, message: String): ConnectionIO[Unit] =
    if condition then ().pure[ConnectionIO] else reject(message)

  def expectedItem(item: AchievementItem, version: Long): ConnectionIO[Unit] =
    ensure(item.version == version, "The achievement changed. Refresh before saving.")

  def accepts(item: AchievementItem, source: MatchSource): Boolean =
    item.gameTitleId == source.gameTitleId &&
      (item.common || item.mapMasterIds.contains(source.mapMasterId))

  /** Acquire live FK targets before the title state; map deletion refreshes that same state. */
  def lockCreationReferences(command: CreateAchievement)(using
      ids: PostgresIdentities): ConnectionIO[Unit] =
    for
      title <- ids.requireReference(Entity.GameTitles, command.gameTitleId.value)
      _ <- sql"SELECT id FROM game_titles WHERE id = $title FOR KEY SHARE".query[UUID].unique
      maps <- ids.requireUuidReferences(Entity.MapMasters, command.mapMasterIds.map(_.value))
      locked <- if maps.isEmpty then List.empty[UUID].pure[ConnectionIO]
      else
        sql"""SELECT id FROM map_masters WHERE id = ANY(${maps.values.toArray}) AND game_title_id = $title
        ORDER BY id FOR KEY SHARE
      """.query[UUID].to[List]
      _ <- ensure(locked.size == maps.size, "A selected map changed before saving.")
    yield ()

  def create(
      id: UUID,
      command: CreateAchievement,
      context: AchievementMutationContext,
  )(using PostgresIdentities): ConnectionIO[Boolean] = create(id, command, context, None)

  def create(
      id: UUID,
      command: CreateAchievement,
      context: AchievementMutationContext,
      fixedKey: Option[String],
  )(using ids: PostgresIdentities): ConnectionIO[Boolean] =
    for
      title <- ids.requireReference(Entity.GameTitles, command.gameTitleId.value)
      maps <- ids.requireUuidReferences(Entity.MapMasters, command.mapMasterIds.map(_.value))
      validMaps <- if maps.isEmpty then true.pure[ConnectionIO]
      else sql"""SELECT count(*) = ${maps.size} FROM map_masters
        WHERE id = ANY(${maps.values.toArray}) AND game_title_id = $title
      """.query[Boolean].unique
      _ <- ensure(validMaps, "Every selected map must belong to this game title.")
      scope = if command.common then "common" else "maps"
      order <-
        sql"SELECT COALESCE(max(sort_order), -1) + 1 FROM achievement_items WHERE game_title_id = $title"
          .query[Int].unique
      inserted <- sql"""INSERT INTO achievement_items(
        id, game_title_id, fixed_key, name, notes, rule_kind, threshold, stars,
        scope_kind, applies_from, sort_order, version, created_at, updated_at
      ) VALUES (
        $id, $title, $fixedKey, ${command.name}, ${command.notes}, ${command.rule.wire},
        ${command.threshold}, ${command.stars}, $scope, NULL, $order, 1, ${context.at}, ${context.at}
      ) ON CONFLICT (id) DO NOTHING""".update.run
      _ <- if inserted == 0 then ().pure[ConnectionIO]
      else maps.values.toList.sorted.traverse_(map => sql"""
        INSERT INTO achievement_item_maps(item_id, map_master_id) VALUES ($id, $map)
      """.update.run.void)
    yield inserted == 1

  def update(
      id: UUID,
      command: UpdateAchievement,
      context: AchievementMutationContext,
  )(using PostgresIdentities): ConnectionIO[AchievementItem] =
    for
      locked <- PostgresAchievementReadOps.lockItems(List(id))
      item <-
        locked.headOption.toRight(new AppException(AppError.NotFound("achievement", id.toString)))
          .liftTo[ConnectionIO]
      _ <- expectedItem(item, command.expectedVersion)
      _ <- ensure(item.retiredAt.isEmpty, "A retired definition is preserved and cannot be edited.")
      changed = item.name != command.name || item.notes != command.notes ||
        item.stars != command.stars
      _ <- if !changed then ().pure[ConnectionIO]
      else sql"""UPDATE achievement_items SET name = ${command.name}, notes = ${command.notes},
        stars = ${command.stars}, version = version + 1, updated_at = ${context.at} WHERE id = $id
      """.update.run.void
      _ <- if item.stars == command.stars then ().pure[ConnectionIO]
      else PostgresSeriesAnalysisMutationOps.enqueueAchievementMutation(List(item.gameTitleId))
      saved <- PostgresAchievementReadOps.item(id)
    yield saved

  /** Item locks precede every claim lock, including automatic unlink/date-follow on match edits. */
  def lockForMatch(
      id: MatchId,
      additions: List[AddMatchAchievement],
  )(using ids: PostgresIdentities): ConnectionIO[List[AchievementItem]] =
    if ids == PostgresIdentities.Legacy then
      ensure(additions.isEmpty, "Achievements require the current database contract.")
        .as(List.empty[AchievementItem])
    else
      for
        linked <-
          sql"SELECT DISTINCT item_id FROM achievement_claims WHERE match_id = ${ids.lookup(Entity.Matches, id.value)}"
            .query[UUID].to[List]
        items <- PostgresAchievementReadOps.lockItems(linked ++ additions.map(_.achievementId))
        _ <- ensure(
          additions.forall(value => items.exists(_.id.equals(value.achievementId))),
          "An achievement no longer exists. Refresh before saving."
        )
      yield items

  def addDeclarations(
      source: MatchSource,
      additions: List[AddMatchAchievement],
      items: List[AchievementItem],
      context: AchievementMutationContext,
  )(using ids: PostgresIdentities): ConnectionIO[Boolean] =
    if additions.isEmpty then false.pure[ConnectionIO]
    else
      for
        normalized <- additions.traverse(value =>
          ids.normalize(Entity.Members, value.memberId.value)
            .map(member => value.copy(memberId = MemberId.unsafeFromString(member)))
        )
        _ <- ensure(
          normalized.map(v => v.achievementId -> v.memberId).distinct.size == normalized.size,
          "Duplicate achievement declarations."
        )
        roster <- sql"SELECT ${ids.wireId("m")} FROM members m".query[MemberId].to[List]
        _ <- ensure(
          normalized.forall(value => roster.contains(value.memberId)),
          "Unknown achievement player."
        )
        selected = normalized.map(_.achievementId).distinct.toArray
        roots <-
          PostgresAchievementReadOps.claims(fr"WHERE c.item_id = ANY($selected)", lock = true)
        actor <- ids.requireReference(Entity.Accounts, context.accountId.value)
        matched <- ids.requireReference(Entity.Matches, source.id.value)
        changed <- normalized.sortBy(value =>
          (value.achievementId.toString, value.memberId.value)
        ).traverse { addition =>
          val item = items.find(_.id.equals(addition.achievementId)).get
          val root = roots.find(value =>
            value.achievementId.equals(item.id) &&
              value.memberId == addition.memberId && value.sourceKind == "direct"
          )
          for
            _ <- expectedItem(item, addition.expectedItemVersion)
            _ <- ensure(
              item.retiredAt.isEmpty && item.rule == AchievementRule.Manual,
              "Only active manual achievements can be added to a match."
            )
            _ <- ensure(
              accepts(item, source),
              "The match is outside this achievement's game title or maps."
            )
            _ <- ensure(
              root.map(_.version) == addition.expectedClaimVersion,
              "The saved achievement changed. Refresh before saving."
            )
            result <- root match
              case Some(value) if value.state == "achieved" => false.pure[ConnectionIO]
              case Some(value) =>
                val generation = UUID.randomUUID()
                sql"""UPDATE achievement_claims SET state = 'achieved', match_id = $matched,
                  achieved_at = ${source.playedAt}, generation_id = $generation, version = version + 1,
                  updated_by_account_id = $actor, updated_at = ${context.at} WHERE id = ${value.id}
                """.update.run.as(true)
              case None =>
                for
                  member <- ids.requireReference(Entity.Members, addition.memberId.value)
                  claimId = UUID.randomUUID()
                  generation = UUID.randomUUID()
                  _ <- sql"""INSERT INTO achievement_claims
                    (id, item_id, member_id, source_kind, state, match_id, achieved_at,
                     generation_id, version, updated_by_account_id, updated_at)
                    VALUES ($claimId, ${item.id}, $member, 'direct', 'achieved', $matched,
                      ${source.playedAt}, $generation, 1, $actor, ${context.at})
                  """.update.run
                yield true
          yield result
        }
      yield changed.contains(true)

  def followMatch(
      id: MatchId,
      next: Option[MatchSource],
      items: List[AchievementItem],
      context: AchievementMutationContext,
  )(using ids: PostgresIdentities): ConnectionIO[Unit] =
    if items.isEmpty then ().pure[ConnectionIO]
    else
      for
        roots <- PostgresAchievementReadOps.claims(
          fr"WHERE c.match_id = ${ids.lookup(Entity.Matches, id.value)}",
          lock = true
        )
        actor <- ids.requireReference(Entity.Accounts, context.accountId.value)
        _ <- roots.traverse_ { root =>
          val item = items.find(_.id.equals(root.achievementId))
          if item.exists(value => value.retiredAt.nonEmpty && value.rule != AchievementRule.Manual)
          then
            ().pure[ConnectionIO]
          else
            val applicable = next.filter(source => item.exists(accepts(_, source)))
            val nextDate = applicable.map(_.playedAt).orElse(root.achievedAt)
            val nextMatch = applicable.map(_.id)
            if nextDate.equals(root.achievedAt) && nextMatch == root.matchId then
              ().pure[ConnectionIO]
            else sql"""UPDATE achievement_claims
            SET match_id = ${ids.lookup(Entity.Matches, nextMatch.map(_.value))},
                achieved_at = $nextDate, version = version + 1,
                updated_by_account_id = $actor, updated_at = ${context.at}
            WHERE id = ${root.id}
          """.update.run.void
        }
      yield ()

  def correctClaim(
      id: UUID,
      command: CorrectAchievementClaim,
      context: AchievementMutationContext,
  )(using ids: PostgresIdentities): ConnectionIO[AchievementClaim] =
    for
      initial <- PostgresAchievementReadOps.claim(id)
      normalizedMatch <- ids.normalize(Entity.Matches, command.matchId.map(_.value))
        .map(_.map(MatchId.unsafeFromString))
      sources <- PostgresAchievementMatchLocks.lockMatches((initial.matchId.toList ++
        normalizedMatch.toList).distinct)
      items <- PostgresAchievementReadOps.lockItems(List(initial.achievementId))
      item <- items.headOption.toRight(new AppException(AppError.NotFound(
        "achievement",
        initial.achievementId.toString
      )))
        .liftTo[ConnectionIO]
      locked <- PostgresAchievementReadOps.claims(fr"WHERE c.id = $id", lock = true)
      previous <- locked.headOption.toRight(new AppException(AppError.NotFound(
        "achievement claim",
        id.toString
      )))
        .liftTo[ConnectionIO]
      _ <- expectedItem(item, command.expectedItemVersion)
      _ <- ensure(
        previous.version == command.expectedVersion,
        "The achievement record changed. Refresh before saving."
      )
      _ <- ensure(
        item.rule == AchievementRule.Manual,
        "Automatic achievements are determined only from saved match records."
      )
      source = normalizedMatch.flatMap(matched => sources.find(_.id == matched))
      _ <-
        ensure(normalizedMatch.isEmpty || source.nonEmpty, "The selected match no longer exists.")
      _ <- source.traverse_(value =>
        ensure(
          command.expectedMatchVersion.contains(value.version) && accepts(item, value),
          "The selected match changed or is outside this achievement's scope."
        )
      )
      _ <- ensure(
        source.forall(value => command.achievedAt.forall(_.equals(value.playedAt))),
        "A linked achievement uses the match's played-at time."
      )
      _ <- ensure(
        previous.matchId.isEmpty || normalizedMatch.nonEmpty ||
          command.achievedAt.forall(value => previous.achievedAt.contains(value)),
        "Unlink the match before correcting an independent achievement date."
      )
      date = if command.state == "cancelled" then previous.achievedAt
      else
        source.map(_.playedAt).orElse(if previous.matchId.nonEmpty then previous.achievedAt
        else command.achievedAt)
      link = if command.state == "cancelled" then None else normalizedMatch
      actor <- ids.requireReference(Entity.Accounts, context.accountId.value)
      _ <- sql"""UPDATE achievement_claims SET state = ${command.state},
        match_id = ${ids.lookup(Entity.Matches, link.map(_.value))}, achieved_at = $date,
        version = version + 1, updated_by_account_id = $actor, updated_at = ${context.at}
        WHERE id = $id
      """.update.run
      _ <- PostgresSeriesAnalysisMutationOps.enqueueAchievementMutation(List(item.gameTitleId))
      result <- PostgresAchievementReadOps.claim(id)
    yield result
