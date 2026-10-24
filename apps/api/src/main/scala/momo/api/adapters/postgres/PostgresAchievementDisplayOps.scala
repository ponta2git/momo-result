package momo.api.adapters.postgres

import java.util.UUID

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import io.circe.{Json, JsonObject}

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.domain.ids.GameTitleId
import momo.api.errors.{AppError, AppException}

private[postgres] final case class AchievementDisplayMetadata(
    items: Map[String, (String, String, Int)],
    maps: List[(String, String)],
    matches: Set[String],
    events: Set[String],
)

private[postgres] object PostgresAchievementDisplayOps:
  private def identifiers(value: Json, field: String): List[String] = value.arrayOrObject(
    Nil,
    _.toList.flatMap(identifiers(_, field)),
    fields =>
      fields(field).flatMap(_.asString).toList ++
        fields.values.toList.flatMap(identifiers(_, field)),
  ).distinct

  def read(title: GameTitleId, payload: Json)(using ids: PostgresIdentities)
      : ConnectionIO[AchievementDisplayMetadata] =
    val itemIds = identifiers(payload, "achievementId")
    val mapIds = payload.hcursor.downField("summaries").focus.toList
      .flatMap(identifiers(_, "mapMasterId")).distinct
    val matchIds = identifiers(payload, "matchId")
    val eventIds = identifiers(payload, "heldEventId")
    for
      parsed <- itemIds.traverse(value =>
        Either.catchNonFatal(UUID.fromString(value)).leftMap(_ =>
          new AppException(AppError.Internal("Invalid achievement identifier in artifact."))
        ).liftTo[ConnectionIO]
      )
      items <- sql"""SELECT i.id::text,
        CASE WHEN s.item_id IS NULL THEN i.name ELSE s.snapshot->'definition'->>'name' END,
        CASE WHEN s.item_id IS NULL THEN i.notes ELSE s.snapshot->'definition'->>'notes' END,
        i.sort_order
        FROM achievement_items i LEFT JOIN achievement_retired_snapshots s ON s.item_id = i.id
        WHERE i.id = ANY(${parsed.toArray}) AND i.game_title_id = ${ids.lookup(
          Entity.GameTitles,
          title.value
        )}
      """.query[(String, String, String, Int)].to[List]
      _ <- if items.size == itemIds.size then ().pure[ConnectionIO]
      else
        new AppException(AppError.Internal("Achievement display metadata is unavailable."))
          .raiseError[ConnectionIO, Unit]
      maps <- if mapIds.isEmpty then List.empty[(String, String)].pure[ConnectionIO]
      else sql"""SELECT ${ids.wireId("m")}, m.name FROM map_masters m
        WHERE ${ids.retainedIn("m", "id", mapIds)}
          AND m.game_title_id = ${ids.lookup(Entity.GameTitles, title.value)}
      """.query[(String, String)].to[List]
      matches <- if matchIds.isEmpty then List.empty[String].pure[ConnectionIO]
      else
        sql"SELECT ${ids.wireId("m")} FROM matches m WHERE ${ids.retainedIn("m", "id", matchIds)}"
          .query[String].to[List]
      events <- if eventIds.isEmpty then List.empty[String].pure[ConnectionIO]
      else
        sql"SELECT ${ids.wireId("e")} FROM held_events e WHERE ${ids.retainedIn("e", "id", eventIds)}"
          .query[String].to[List]
      mapNames = maps.toMap
    yield AchievementDisplayMetadata(
      items.map((id, name, notes, order) => id -> (name, notes, order)).toMap,
      mapIds.map(id => id -> mapNames.getOrElse(id, "削除済みマップ")),
      matches.toSet,
      events.toSet,
    )

  def hydrate(value: Json, metadata: AchievementDisplayMetadata): Json =
    def children(json: Json): Json = json.arrayOrObject(
      json,
      values => Json.fromValues(values.map(children)),
      fields =>
        val nested =
          JsonObject.fromIterable(fields.toIterable.map((key, child) => key -> children(child)))
        val named = fields("achievementId").flatMap(_.asString).flatMap(metadata.items.get) match
          case Some((name, notes, _)) =>
            nested.add("name", Json.fromString(name)).add("notes", Json.fromString(notes))
          case None => nested
        val linked =
          if fields.contains("claimId") && fields.contains("matchId") &&
            fields.contains("heldEventId")
          then
            named.add(
              "matchAvailable",
              Json.fromBoolean(
                fields("matchId").flatMap(_.asString).exists(metadata.matches.contains)
              )
            )
              .add(
                "heldEventAvailable",
                Json.fromBoolean(
                  fields("heldEventId").flatMap(_.asString).exists(metadata.events.contains)
                )
              )
          else named
        Json.fromJsonObject(linked),
    )
    children(value).mapObject { fields =>
      val ordered = fields("items").flatMap(_.asArray).map(_.sortBy { item =>
        val id = item.hcursor.get[String]("achievementId").getOrElse("")
        (metadata.items.get(id).map(_._3).getOrElse(Int.MaxValue), id)
      })
      val sorted = ordered.fold(fields)(items => fields.add("items", Json.fromValues(items)))
      sorted.add(
        "maps",
        Json.fromValues(metadata.maps.map((id, name) =>
          Json.obj("mapMasterId" -> Json.fromString(id), "displayName" -> Json.fromString(name))
        ))
      )
    }
