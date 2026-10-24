package momo.api.tools

import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.UUID

import cats.syntax.all.*
import io.circe.Decoder
import io.circe.generic.semiauto.deriveDecoder
import io.circe.parser.decode

import momo.api.domain.*
import momo.api.domain.ids.{AccountId, GameTitleId, MapMasterId, MemberId}

/** The one-time source format is deliberately explicit; player data never enters the manifest. */
private[api] object InitialAchievementInput:
  final case class PlayerColumn(column: String, memberId: String)
  final case class Mapping(
      gameTitleId: String,
      eastMapId: String,
      westMapId: String,
      accountId: String,
      players: List[PlayerColumn],
  )
  final case class Definition(
      sourceRow: Int,
      id: String,
      fixedKey: String,
      name: String,
      notes: String,
      stars: Int,
      scope: String,
      ruleKind: String,
      threshold: Option[String],
  )
  final case class Manifest(formatVersion: Int, items: List[Definition])
  final case class Prepared(
      command: AchievementInitialization,
      accountId: AccountId,
      confirmed: Int,
      unconfirmed: Int,
      sourceChecksum: String,
      manifestChecksum: String,
  )

  private given Decoder[PlayerColumn] = deriveDecoder
  private given Decoder[Mapping] = deriveDecoder
  private given Decoder[Definition] = deriveDecoder
  private given Decoder[Manifest] = deriveDecoder

  def prepare(manifestJson: String, mappingJson: String, tsv: String): Either[String, Prepared] =
    for
      manifest <- decode[Manifest](manifestJson).leftMap(_ => "Invalid catalog manifest JSON.")
      mapping <- decode[Mapping](mappingJson).leftMap(_ => "Invalid explicit mapping JSON.")
      _ <- check(manifest.formatVersion == 1, "Unsupported catalog manifest version.")
      _ <- check(
        manifest.items.size == 31 && manifest.items.map(_.sourceRow).sorted == (1 to 31).toList &&
          manifest.items.map(_.id).distinct.size == 31 &&
          manifest.items.map(_.fixedKey).distinct.size == 31,
        "The initial catalog must contain the 31 unique source rows and identities.",
      )
      _ <- check(
        mapping.players.size == 4 && mapping.players.map(_.column).distinct.size == 4 &&
          mapping.players.map(_.memberId).distinct.size == 4 &&
          mapping.eastMapId != mapping.westMapId,
        "Provide four distinct player columns and distinct east/west maps.",
      )
      title <- GameTitleId.fromString(mapping.gameTitleId)
      east <- MapMasterId.fromString(mapping.eastMapId)
      west <- MapMasterId.fromString(mapping.westMapId)
      actor <- AccountId.fromString(mapping.accountId)
      players <- mapping.players.traverse(p => MemberId.fromString(p.memberId))
      rows = tsv.stripPrefix("\uFEFF").linesIterator.map(_.split("\t", -1).toList).toList
      _ <- check(
        rows.size == 32 && rows.forall(_.size == 9),
        "TSV must have one header and 31 nine-column rows."
      )
      header <- rows.headOption.toRight("TSV header is missing.")
      _ <- check(
        header.slice(4, 8) == mapping.players.map(_.column),
        "TSV player columns do not match the explicit mapping order."
      )
      items <- manifest.items.sortBy(_.sourceRow).traverse { definition =>
        val row = rows(definition.sourceRow)
        for
          id <- Either.catchNonFatal(UUID.fromString(definition.id)).leftMap(_ =>
            "Invalid manifest item UUID."
          )
          rule <- AchievementRule.fromWire(definition.ruleKind).toRight("Unknown manifest rule.")
          threshold <- definition.threshold.traverse(value =>
            Either.catchNonFatal(BigDecimal(value)).leftMap(_ => "Invalid manifest threshold.")
          )
          maps <- definition.scope match
            case "common" => Right(List.empty[MapMasterId])
            case "east" => Right(List(east))
            case "west" => Right(List(west))
            case _ => Left("Unknown manifest map scope.")
          category = definition.scope match
            case "east" => "東日本"
            case "west" => "西日本"
            case _ => "共通"
          _ <- check(
            row.headOption.contains(definition.sourceRow.toString) && row(1) == category &&
              row(2) == definition.name && row(3).trim == "★" * definition.stars &&
              row(8) == definition.notes,
            s"Source row ${definition.sourceRow.toString} differs from the pinned catalog manifest.",
          )
          _ <- check(
            definition.stars >= 1 && definition.stars <= 5 &&
              (if rule == AchievementRule.Manual then threshold.isEmpty
               else threshold.exists(_ > 0)),
            "Invalid manifest stars or condition.",
          )
        yield InitialAchievementItem(
          id,
          definition.fixedKey,
          CreateAchievement(
            title,
            definition.name,
            definition.notes,
            maps.isEmpty,
            maps,
            rule,
            threshold,
            definition.stars
          ),
        )
      }
      claims <- items.zipWithIndex.flatTraverse { case (item, index) =>
        rows(index + 1).slice(4, 8).zip(players).traverse { case (mark, player) =>
          mark.trim match
            case "" => Right(None)
            case "達成！" => Right(Some(InitialAchievementClaim(item.id, player, "achieved")))
            case "達成？" => Right(Some(InitialAchievementClaim(item.id, player, "unconfirmed")))
            case _ => Left(s"Unknown achievement mark at source row ${(index + 1).toString}.")
        }.map(_.flatten)
      }
    yield Prepared(
      AchievementInitialization(items, claims),
      actor,
      claims.count(_.state == "achieved"),
      claims.count(_.state == "unconfirmed"),
      checksum(tsv),
      checksum(manifestJson),
    )

  private def check(condition: Boolean, message: String): Either[String, Unit] =
    Either.cond(condition, (), message)

  private def checksum(value: String): String =
    "sha256:" + MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))
      .map(byte => f"${byte & 0xff}%02x").mkString
