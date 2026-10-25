package momo.api.adapters.postgres

import java.time.{Instant, LocalDate}
import java.util.UUID

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.*
import momo.api.domain.ids.*
import momo.api.errors.{AppError, AppException}

private[postgres] object PostgresAchievementReadOps:
  val MaximumItems = 4096
  val MaximumClaims = MaximumItems * 8

  private final case class ItemRow(
      id: UUID,
      title: GameTitleId,
      name: String,
      notes: String,
      scopeKind: String,
      rule: String,
      threshold: Option[BigDecimal],
      stars: Int,
      sortOrder: Int,
      appliesFrom: Option[LocalDate],
      retiredAt: Option[Instant],
      version: Long,
      fixedKey: Option[String],
  )

  private def itemColumns(using ids: PostgresIdentities): Fragment = fr"""
    i.id, ${ids.wireReference(Entity.GameTitles, fr"i.game_title_id")}, i.name, i.notes,
    i.scope_kind, i.rule_kind, i.threshold, i.stars, i.sort_order, i.applies_from,
    i.retired_at, i.version, i.fixed_key
  """

  private def decodeItem(row: ItemRow, maps: List[MapMasterId]): ConnectionIO[AchievementItem] =
    AchievementRule.fromWire(row.rule).filter(_ =>
      row.version >= 1 && row.sortOrder >= 0 && Set("common", "maps").contains(row.scopeKind) &&
        (if row.scopeKind == "common" then maps.isEmpty else maps.nonEmpty)
    ).toRight(PostgresDataIntegrityException.inconsistentRow(
      "achievement_items",
      row.id.toString,
      "invalid achievement definition"
    )).liftTo[ConnectionIO].map(rule =>
      AchievementItem(
        row.id,
        row.title,
        row.name,
        row.notes,
        row.scopeKind == "common",
        maps,
        rule,
        row.threshold,
        row.stars,
        row.sortOrder,
        row.appliesFrom,
        row.retiredAt,
        row.version,
        row.fixedKey,
      )
    )

  private def items(where: Fragment, lock: Boolean)(using ids: PostgresIdentities)
      : ConnectionIO[List[AchievementItem]] =
    val query = fr"SELECT" ++ itemColumns ++ fr"FROM achievement_items i" ++ where ++
      fr"ORDER BY i.id" ++ (if lock then fr"FOR UPDATE" else Fragment.empty)
    for
      rows <- PostgresReadBudget.rows[ItemRow](query, MaximumItems, "Achievement catalog")
      selected = rows.map(_.id).toArray
      mapRows <- if rows.isEmpty then List.empty[(UUID, MapMasterId)].pure[ConnectionIO]
      else
        sql"""SELECT im.item_id, ${ids.wireReference(Entity.MapMasters, fr"im.map_master_id")}
        FROM achievement_item_maps im WHERE im.item_id = ANY($selected)
        ORDER BY im.item_id, ${ids.wireReference(
            Entity.MapMasters,
            fr"im.map_master_id"
          )} COLLATE "C"
      """.query[(UUID, MapMasterId)].to[List]
      byItem = mapRows.groupMap(_._1)(_._2)
      decoded <- rows.traverse(row => decodeItem(row, byItem.getOrElse(row.id, Nil)))
    yield decoded

  def forTitle(title: GameTitleId)(using
      ids: PostgresIdentities): ConnectionIO[List[AchievementItem]] =
    items(fr"WHERE i.game_title_id = ${ids.lookup(Entity.GameTitles, title.value)}", false)
      .map(_.sortBy(item => (item.sortOrder, item.id.toString)))

  def lockItems(selected: List[UUID])(using
      PostgresIdentities): ConnectionIO[List[AchievementItem]] =
    if selected.isEmpty then List.empty[AchievementItem].pure[ConnectionIO]
    else items(fr"WHERE i.id = ANY(${selected.distinct.toArray})", true)

  def item(id: UUID)(using PostgresIdentities): ConnectionIO[AchievementItem] =
    items(fr"WHERE i.id = $id", false).flatMap(_.headOption.toRight(
      new AppException(AppError.NotFound("achievement", id.toString))
    ).liftTo[ConnectionIO])

  private def claimColumns(using ids: PostgresIdentities): Fragment = fr"""
    c.id, c.item_id, ${ids.wireReference(Entity.Members, fr"c.member_id")},
    c.source_kind, c.state, ${ids.wireReference(Entity.Matches, fr"c.match_id")},
    c.achieved_at, c.generation_id, c.version, a.display_name, c.updated_at
  """

  def claims(where: Fragment)(using PostgresIdentities): ConnectionIO[List[AchievementClaim]] =
    claims(where, false)

  def claims(where: Fragment, lock: Boolean)(using ids: PostgresIdentities)
      : ConnectionIO[List[AchievementClaim]] =
    PostgresReadBudget.rows[AchievementClaim](
      fr"SELECT" ++ claimColumns ++ fr"""FROM achievement_claims c
        JOIN momo_login_accounts a ON a.id = c.updated_by_account_id""" ++ where ++
        // Claim identities never change. Keep concurrent corrections exclusive while allowing
        // retirement's FK KEY SHARE to capture a committed generation after locking title state.
        fr"ORDER BY c.id" ++ (if lock then fr"FOR NO KEY UPDATE OF c" else Fragment.empty),
      MaximumClaims,
      "Achievement claims",
    )

  def claim(id: UUID)(using PostgresIdentities): ConnectionIO[AchievementClaim] =
    claims(fr"WHERE c.id = $id").flatMap(_.headOption.toRight(
      new AppException(AppError.NotFound("achievement claim", id.toString))
    ).liftTo[ConnectionIO])

  def catalog(title: GameTitleId)(using ids: PostgresIdentities): ConnectionIO[AchievementCatalog] =
    for
      normalized <- ids.normalize(Entity.GameTitles, title.value).map(GameTitleId.unsafeFromString)
      exists <-
        sql"SELECT EXISTS(SELECT 1 FROM game_titles WHERE id = ${ids.lookup(Entity.GameTitles, normalized.value)})"
          .query[Boolean].unique
      _ <- if exists then ().pure[ConnectionIO]
      else
        new AppException(AppError.NotFound(
          "game title",
          title.value
        )).raiseError[ConnectionIO, Unit]
      definitions <- forTitle(normalized)
      roots <- claims(fr"WHERE c.item_id = ANY(${definitions.map(_.id).toArray})")
      members <- sql"""SELECT ${ids.wireId(
          "m"
        )}, m.display_name FROM members m ORDER BY ${ids.wireId("m")} COLLATE "C" """
        .query[(MemberId, String)].to[List]
      maps <- sql"""SELECT ${ids.wireId("m")}, m.name FROM map_masters m
        WHERE m.game_title_id = ${ids.lookup(Entity.GameTitles, normalized.value)}
        ORDER BY m.display_order, ${ids.wireId("m")} COLLATE "C"
      """.query[(MapMasterId, String)].to[List]
    yield AchievementCatalog(
      normalized,
      PostgresAchievementOrderOps.revision(normalized, definitions),
      definitions,
      roots,
      members,
      maps
    )
