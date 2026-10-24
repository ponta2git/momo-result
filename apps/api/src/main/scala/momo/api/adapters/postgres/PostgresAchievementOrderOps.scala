package momo.api.adapters.postgres

import java.util.UUID

import doobie.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.domain.ids.GameTitleId
import momo.api.domain.{AchievementCatalog, AchievementItem, ReorderAchievements}
import momo.api.util.Sha256

/** Display order has its own optimistic token and never changes scoring or item edit versions. */
private[postgres] object PostgresAchievementOrderOps:
  def revision(title: GameTitleId, items: List[AchievementItem]): String =
    Sha256.hexUtf8(title.value + "\n" + items.sortBy(_.id.toString)
      .map(item => s"${item.id}:${item.sortOrder}:${item.retiredAt.nonEmpty}").mkString("\n"))

  def reorder(command: ReorderAchievements)(using ids: PostgresIdentities)
      : ConnectionIO[AchievementCatalog] =
    for
      normalized <- ids.normalize(Entity.GameTitles, command.gameTitleId.value)
        .map(GameTitleId.unsafeFromString)
      _ <- ids.requireReference(Entity.GameTitles, normalized.value)
      before <- PostgresAchievementReadOps.forTitle(normalized)
      _ <- PostgresAchievementReadOps.lockItems(before.map(_.id))
      // Item locks precede title state. After waiting for a concurrent insertion, re-read the full
      // catalog before checking membership and its token; never acquire newly added item locks here.
      _ <- PostgresAchievementRetirementOps.state(normalized, lock = true)
      current <- PostgresAchievementReadOps.forTitle(normalized)
      _ <- PostgresAchievementWriteOps.ensure(
        revision(normalized, current) == command.expectedOrderRevision &&
          command.achievementIds.size == current.size &&
          command.achievementIds.toSet.equals(current.map(_.id).toSet),
        "The achievement order or catalog changed. Refresh before saving the order."
      )
      positions = command.achievementIds.zipWithIndex.toMap
      changes = current.flatMap(item =>
        positions.get(item.id).filter(_ != item.sortOrder).map(_ -> item.id)
      )
      _ <- Update[(Int, UUID)]("UPDATE achievement_items SET sort_order = ? WHERE id = ?")
        .updateMany(changes)
      saved <- PostgresAchievementReadOps.catalog(normalized)
    yield saved
