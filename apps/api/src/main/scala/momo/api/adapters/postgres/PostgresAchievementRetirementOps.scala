package momo.api.adapters.postgres

import java.util.UUID

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import io.circe.syntax.*
import io.circe.{Codec, Json}

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.contracts.seriesanalysis.SeriesAnalysisArtifactContract
import momo.api.domain.*
import momo.api.domain.ids.GameTitleId
import momo.api.errors.{AppError, AppException}

/** Durable business format 1. It deliberately does not embed an analysis resource/envelope. */
private[postgres] object PostgresAchievementRetirementOps:
  final case class Proof(
      kind: String,
      state: String,
      claimId: Option[String],
      generationId: Option[String],
      sourceAchievementId: Option[String],
      matchId: Option[String],
      heldEventId: Option[String],
      achievedAt: Option[String],
  ) derives Codec.AsObject
  final case class Player(
      memberId: String,
      status: String,
      firstAchievedAt: Option[String],
      dateUnknown: Boolean,
      proofs: List[Proof],
  ) derives Codec.AsObject
  final case class Artifact(artifact: SeriesAnalysisArtifactRef, players: List[Player])
  final case class TitleState(
      revision: Long,
      algorithm: String,
      schema: Int,
      validation: Option[String],
      pending: Boolean,
      current: Option[String],
  )

  def state(title: GameTitleId, lock: Boolean)(using
      ids: PostgresIdentities): ConnectionIO[TitleState] =
    (fr"""SELECT s.input_revision, s.algorithm_version, s.artifact_schema_version,
      s.validation_contract_id, s.pending_work,
      ${ids.wireReference(Entity.AnalysisArtifacts, fr"s.current_artifact_id")}
      FROM series_analysis_title_states s
      WHERE s.game_title_id = ${ids.lookup(Entity.GameTitles, title.value)}""" ++
      (if lock then fr"FOR UPDATE OF s" else Fragment.empty)).query[TitleState].option.flatMap(
      _.toRight(new AppException(AppError.AnalysisStateUnavailable())).liftTo[ConnectionIO]
    )

  def decode(chunk: DecodedSeriesAnalysisChunk, id: UUID): Either[AppError, Artifact] =
    for
      items <- chunk.payload.hcursor.get[List[Json]]("items")
        .leftMap(_ => AppError.Internal("Invalid achievement artifact."))
      selected <- items.find(_.hcursor.get[String]("achievementId").contains(id.toString))
        .toRight(AppError.Conflict("The latest result does not contain this achievement."))
      players <- selected.hcursor.get[List[Player]]("players")
        .leftMap(_ => AppError.Internal("Invalid achievement retirement record."))
      _ <- Either.cond(
        players.size == 4 && players.map(_.memberId).distinct.size == 4,
        (),
        AppError.Internal("Retirement requires the complete four-player result.")
      )
    yield Artifact(chunk.artifact, players)

  def retire(
      id: UUID,
      version: Long,
      prepared: Option[Artifact],
      context: AchievementMutationContext,
  )(using ids: PostgresIdentities): ConnectionIO[AchievementItem] =
    for
      locked <- PostgresAchievementReadOps.lockItems(List(id))
      item <-
        locked.headOption.toRight(new AppException(AppError.NotFound("achievement", id.toString)))
          .liftTo[ConnectionIO]
      _ <- PostgresAchievementWriteOps.expectedItem(item, version)
      _ <- PostgresAchievementWriteOps.ensure(
        item.retiredAt.isEmpty,
        "This achievement is already retired."
      )
      current <- state(item.gameTitleId, lock = true)
      _ <- if item.rule == AchievementRule.Manual then captureManualSources(item)
      else
        prepared match
          case None => PostgresAchievementWriteOps.reject(
              "Wait for the latest successful calculation before retiring."
            )
          case Some(value) =>
            for
              _ <- PostgresAchievementWriteOps.ensure(
                !current.pending && current.current.contains(value.artifact.artifactId) &&
                  current.revision == value.artifact.inputRevision &&
                  current.algorithm == value.artifact.algorithmVersion &&
                  current.schema == value.artifact.artifactSchemaVersion &&
                  SeriesAnalysisArtifactContract.supports(current.schema, current.validation),
                "The calculation changed or is still pending. Refresh and retire after it succeeds.",
              )
              snapshot = Json.obj(
                "definition" -> definition(item, context),
                "players" -> value.players.asJson,
              )
              _ <- sql"""INSERT INTO achievement_retired_snapshots
              (item_id, format_version, source_input_revision, snapshot, created_at)
              VALUES ($id, 1, ${current.revision}, ${snapshot.noSpaces}::jsonb, ${context.at})
            """.update.run
            yield ()
      _ <- sql"""UPDATE achievement_items SET retired_at = ${context.at}, version = version + 1,
        updated_at = ${context.at} WHERE id = $id
      """.update.run
      _ <- PostgresSeriesAnalysisMutationOps.enqueueAchievementMutation(List(item.gameTitleId))
      result <- PostgresAchievementReadOps.item(id)
    yield result

  /** Plain SELECT after the title lock: never acquire parent item/root locks in reverse order. */
  private def captureManualSources(item: AchievementItem)(using
      ids: PostgresIdentities): ConnectionIO[Unit] =
    val parentKey = item.fixedKey.flatMap {
      case "momotetsu2-patrol-dubbing-four" => Some("momotetsu2-patrol-four")
      case "momotetsu2-no-one-three-months" => Some("momotetsu2-no-one-six-months")
      case _ => None
    }
    parentKey.traverse_(key =>
      sql"""INSERT INTO achievement_retired_manual_sources(item_id, claim_id, generation_id)
      SELECT ${item.id}, c.id, c.generation_id FROM achievement_claims c
      JOIN achievement_items parent ON parent.id = c.item_id
      WHERE parent.fixed_key = $key AND parent.game_title_id = ${ids.lookup(
          Entity.GameTitles,
          item.gameTitleId.value
        )}
        AND c.state = 'achieved'
      ON CONFLICT DO NOTHING
    """.update.run.void
    )

  private def definition(item: AchievementItem, context: AchievementMutationContext): Json =
    Json.obj(
      "achievementId" -> item.id.toString.asJson,
      "gameTitleId" -> item.gameTitleId.value.asJson,
      "name" -> item.name.asJson,
      "notes" -> item.notes.asJson,
      "common" -> item.common.asJson,
      "mapMasterIds" -> item.mapMasterIds.map(_.value).asJson,
      "ruleKind" -> item.rule.wire.asJson,
      "threshold" -> item.threshold.map(_.bigDecimal.stripTrailingZeros.toPlainString).asJson,
      "stars" -> item.stars.asJson,
      "appliesFrom" -> item.appliesFrom.map(_.toString).asJson,
      "retiredAt" -> context.at.toString.asJson,
    )
