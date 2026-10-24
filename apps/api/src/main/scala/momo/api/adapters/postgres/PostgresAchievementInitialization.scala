package momo.api.adapters.postgres

import java.util.UUID

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.*
import momo.api.domain.ids.*

/** Consumer-owned seed execution; the public definition manifest remains owned by momo-db. */
object PostgresAchievementInitialization:
  def validate(
      command: AchievementInitialization,
      context: AchievementMutationContext,
      identities: PostgresIdentities,
  ): ConnectionIO[Unit] =
    val definitions = command.items
    for
      _ <- PostgresAchievementWriteOps.ensure(
        definitions.nonEmpty && definitions.size <= PostgresAchievementReadOps.MaximumItems &&
          definitions.map(_.id).distinct.size == definitions.size &&
          definitions.map(_.fixedKey).distinct.size == definitions.size &&
          definitions.map(_.definition.gameTitleId).distinct.size == 1 &&
          command.claims.map(value => value.achievementId -> value.memberId).distinct.size ==
          command.claims.size &&
          command.claims.forall(value =>
            definitions.exists(_.id.equals(value.achievementId)) &&
              Set("achieved", "unconfirmed").contains(value.state)
          ),
        "Initial achievement identities or claim states are inconsistent.",
      )
      roster <- sql"SELECT ${identities.wireId("m")} FROM members m".query[MemberId].to[List]
      members <-
        command.claims.traverse(value => identities.normalize(Entity.Members, value.memberId.value))
      _ <- PostgresAchievementWriteOps.ensure(
        roster.size == 4 && members.forall(value => roster.exists(_.value == value)),
        "Initial claims must reference the existing four-player roster."
      )
      actor <- sql"""SELECT EXISTS(SELECT 1 FROM momo_login_accounts
        WHERE id = ${identities.lookup(Entity.Accounts, context.accountId.value)}
          AND login_enabled AND role IN ('operator', 'admin'))
      """.query[Boolean].unique
      _ <- PostgresAchievementWriteOps.ensure(
        actor,
        "Initial import requires an enabled operator account."
      )
      _ <- definitions.traverse_ { definition =>
        val item = definition.definition
        for
          title <- identities.requireReference(Entity.GameTitles, item.gameTitleId.value)
          maps <-
            identities.requireUuidReferences(Entity.MapMasters, item.mapMasterIds.map(_.value))
          correct <- if maps.isEmpty then item.common.pure[ConnectionIO]
          else sql"""SELECT count(*) = ${maps.size} FROM map_masters
            WHERE id = ANY(${maps.values.toArray}) AND game_title_id = $title
          """.query[Boolean].unique.map(_ && !item.common)
          _ <- PostgresAchievementWriteOps.ensure(
            correct,
            "Initial maps do not belong to the chosen title."
          )
        yield ()
      }
    yield ()

  def initialize(
      command: AchievementInitialization,
      context: AchievementMutationContext,
      identities: PostgresIdentities,
  ): ConnectionIO[Unit] =
    given PostgresIdentities = identities
    for
      _ <- validate(command, context, identities)
      _ <- command.items.sortBy(_.id.toString).traverse_(item =>
        PostgresAchievementWriteOps.lockCreationReferences(item.definition)
      )
      existing <- PostgresAchievementReadOps.lockItems(command.items.map(_.id))
      _ <- PostgresAchievementReadOps.claims(
        fr"WHERE c.item_id = ANY(${existing.map(_.id).toArray})",
        lock = true
      )
      _ <- command.items.map(_.definition.gameTitleId).distinct.sortBy(_.value).traverse_(title =>
        PostgresAchievementRetirementOps.state(title, lock = true).void
      )
      afterLock <- command.items.map(_.definition.gameTitleId).distinct.traverse(
        PostgresAchievementReadOps.forTitle
      )
      _ <- PostgresAchievementWriteOps.ensure(
        afterLock.flatten.filter(item => command.items.exists(_.id.equals(item.id)))
          .map(_.id).toSet.equals(existing.map(_.id).toSet),
        "The initial catalog changed. Retry the import with the latest saved state."
      )
      _ <- validate(command, context, identities)
      inserted <- command.items.traverse { value =>
        for
          title <- identities.normalize(Entity.GameTitles, value.definition.gameTitleId.value)
          old = existing.find(_.id.equals(value.id))
          _ <- PostgresAchievementWriteOps.ensure(
            old.forall(item =>
              item.fixedKey.contains(value.fixedKey) && item.gameTitleId.value == title
            ),
            "An initial achievement ID already belongs to another definition."
          )
          added <- PostgresAchievementWriteOps.create(
            value.id,
            value.definition,
            context,
            Some(value.fixedKey)
          )
        yield Option.when(added)(value.definition.gameTitleId)
      }
      definitions <- PostgresAchievementReadOps.lockItems(command.items.map(_.id))
      actor <- identities.requireReference(Entity.Accounts, context.accountId.value)
      roots <- command.claims.sortBy(value =>
        (value.achievementId.toString, value.memberId.value)
      ).traverse { value =>
        val item = definitions.find(_.id.equals(value.achievementId)).get
        if item.retiredAt.nonEmpty then Option.empty[GameTitleId].pure[ConnectionIO]
        else
          for
            member <- identities.requireReference(Entity.Members, value.memberId.value)
            claimId = UUID.randomUUID()
            generation = UUID.randomUUID()
            affected <- sql"""INSERT INTO achievement_claims
              (id, item_id, member_id, source_kind, state, generation_id,
               version, updated_by_account_id, updated_at)
              VALUES ($claimId, ${item.id}, $member, 'import', ${value.state},
                $generation, 1, $actor, ${context.at})
              ON CONFLICT (item_id, member_id, source_kind) DO NOTHING
            """.update.run
          yield Option.when(affected == 1)(item.gameTitleId)
      }
      _ <- PostgresSeriesAnalysisMutationOps.enqueueAchievementMutation((inserted ++
        roots).flatten.distinct)
    yield ()
