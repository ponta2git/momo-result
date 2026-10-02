package momo.api.adapters.inmemory

import java.nio.charset.StandardCharsets
import java.time.Instant
import java.util.UUID

import cats.effect.{Ref, Sync}
import cats.syntax.all.*
import io.circe.Json

import momo.api.domain.*
import momo.api.domain.ids.{AccountId, GameTitleId}
import momo.api.errors.AppError
import momo.api.repositories.{GameTitlesRepository, SeriesPlayerRadarRepository}

/** The in-memory runtime accepts durable intent but deliberately has no statistical fallback. */
final class InMemorySeriesPlayerRadarRepository[F[_]: Sync] private (
    titles: GameTitlesRepository[F],
    now: F[Instant],
    state: Ref[F, InMemorySeriesPlayerRadarRepository.State],
) extends SeriesPlayerRadarRepository[F]:
  import InMemorySeriesPlayerRadarRepository.*

  override def radarState(title: GameTitleId): F[Either[AppError, SeriesPlayerRadarDocument]] =
    titles.find(title).flatMap {
      case None => AppError.NotFound("game title", title.value).asLeft.pure[F]
      case Some(_) => state.get.map { snapshot =>
          val candidate = snapshot.candidates.get(title).fold(Json.Null) { value =>
            Json.obj(
              "candidateId" -> Json.fromString(value.id),
              "status" -> Json.fromString(value.status),
              "basisId" -> Json.Null,
              "sourceInputRevision" -> Json.Null,
              "safeFailureCode" -> Json.Null,
              "createdAt" -> Json.fromString(value.createdAt.toString),
              "updatedAt" -> Json.fromString(value.createdAt.toString),
              "result" -> Json.Null,
              "latestPreview" -> Json.Null
            )
          }
          val operations = snapshot.operations.values.map(_._2).filter(_.gameTitleId == title)
            .toList.sortBy(_.requestedAt).reverse.take(10).map(operationJson)
          val json = Json.obj(
            "schemaVersion" -> Json.fromInt(1),
            "gameTitleId" -> Json.fromString(title.value),
            "inputRevision" -> Json.fromString("0"),
            "generation" -> Json.fromString("0"),
            "currentBasis" -> Json.Null,
            "previousBasis" -> Json.Null,
            "candidate" -> candidate,
            "operations" -> Json.fromValues(operations),
            "monitor" -> Json.Null,
            "acknowledgedEvidenceKeys" -> Json.arr(),
            "eligibility" ->
              Json.obj("matchCount" -> Json.fromInt(0), "heldEventCount" -> Json.fromInt(0))
          )
          SeriesPlayerRadarDocument(json.noSpaces.getBytes(StandardCharsets.UTF_8)).asRight
        }
    }

  override def radarPreview(request: SeriesPlayerRadarPreviewRequest)
      : F[Either[AppError, SeriesPlayerRadarDocument]] =
    AppError.NotFound("radar preview", request.previewId).asLeft.pure[F]

  override def radarOperation(title: GameTitleId, id: String)
      : F[Either[AppError, SeriesPlayerRadarOperation]] = state.get.map(_.operations.values
    .map(_._2).find(value => value.gameTitleId == title && value.operationId == id)
    .toRight(AppError.NotFound("radar operation", id)))

  override def requestRadarOperation(
      command: SeriesPlayerRadarCommand,
      requestedBy: AccountId,
      keyHash: String,
      fingerprint: String
  ): F[Either[AppError, SeriesPlayerRadarOperation]] =
    titles.find(command.gameTitleId).flatMap {
      case None => AppError.NotFound("game title", command.gameTitleId.value).asLeft.pure[F]
      case Some(_) => (now, freshId, freshId).tupled.flatMap { case (at, id, candidateId) =>
          state.modify { snapshot =>
            val key = requestedBy -> keyHash
            snapshot.operations.get(key) match
              case Some((saved, operation)) if saved == fingerprint => snapshot -> operation.asRight
              case Some(_) => snapshot -> AppError.IdempotencyPayloadMismatch(
                  "Idempotency-Key was reused for a different radar operation."
                ).asLeft
              case None =>
                val existing = snapshot.candidates.get(command.gameTitleId)
                command.kind match
                  case SeriesPlayerRadarOperationKind.Candidate
                      if existing.forall(_.status == "withdrawn") =>
                    val operation = accepted(command, id, Some(candidateId), "pending", at)
                    snapshot.copy(
                      candidates = snapshot.candidates.updated(
                        command.gameTitleId,
                        Candidate(candidateId, "pending", at)
                      ),
                      operations = snapshot.operations.updated(key, fingerprint -> operation),
                    ) -> operation.asRight
                  case SeriesPlayerRadarOperationKind.Withdraw
                      if existing.exists(value => command.candidateId.contains(value.id)) =>
                    val operation = accepted(command, id, command.candidateId, "succeeded", at)
                    val operations =
                      snapshot.operations.map { case (savedKey, (savedFingerprint, saved)) =>
                        val changed =
                          if saved.candidateId == command.candidateId && saved.status == "pending"
                          then
                            saved.copy(status = "withdrawn", finishedAt = Some(at))
                          else saved
                        savedKey -> (savedFingerprint -> changed)
                      }
                    snapshot.copy(
                      candidates = snapshot.candidates.updated(
                        command.gameTitleId,
                        existing.get.copy(status = "withdrawn")
                      ),
                      operations = operations.updated(key, fingerprint -> operation),
                    ) -> operation.asRight
                  case _ => snapshot -> AppError.Conflict(
                      "The radar operation requires a saved candidate or comparison. Refresh its state."
                    ).asLeft
          }
        }
    }

  private def freshId: F[String] = Sync[F].delay(UUID.randomUUID().toString)

object InMemorySeriesPlayerRadarRepository:
  private final case class Candidate(id: String, status: String, createdAt: Instant)
  private final case class State(
      candidates: Map[GameTitleId, Candidate],
      operations: Map[(AccountId, String), (String, SeriesPlayerRadarOperation)],
  )

  private def accepted(
      command: SeriesPlayerRadarCommand,
      id: String,
      candidateId: Option[String],
      status: String,
      at: Instant
  ): SeriesPlayerRadarOperation = SeriesPlayerRadarOperation(
    id,
    command.gameTitleId,
    command.kind.wire,
    status,
    candidateId,
    None,
    None,
    None,
    None,
    at,
    Option.when(status == "succeeded")(at)
  )

  private def operationJson(value: SeriesPlayerRadarOperation): Json =
    def text(value: Option[String]): Json = value.fold(Json.Null)(Json.fromString)
    Json.obj(
      "schemaVersion" -> Json.fromInt(1),
      "operationId" -> Json.fromString(value.operationId),
      "gameTitleId" -> Json.fromString(value.gameTitleId.value),
      "kind" -> Json.fromString(value.kind),
      "status" -> Json.fromString(value.status),
      "candidateId" -> text(value.candidateId),
      "previewId" -> text(value.previewId),
      "basisId" -> text(value.basisId),
      "originOperationId" -> text(value.originOperationId),
      "safeFailureCode" -> text(value.safeFailureCode),
      "requestedAt" -> Json.fromString(value.requestedAt.toString),
      "finishedAt" -> text(value.finishedAt.map(_.toString))
    )

  def create[F[_]: Sync](titles: GameTitlesRepository[F], now: F[Instant])
      : F[InMemorySeriesPlayerRadarRepository[F]] =
    Ref.of[F, State](State(
      Map.empty,
      Map.empty
    )).map(new InMemorySeriesPlayerRadarRepository(titles, now, _))
