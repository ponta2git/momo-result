package momo.api.adapters.postgres

import java.time.Instant

import cats.data.EitherT
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.domain.*
import momo.api.domain.ids.{AccountId, GameTitleId}
import momo.api.errors.AppError

/** Title-serialized acceptance only. Calculation and publication belong to the Worker. */
private[postgres] object PostgresSeriesPlayerRadarCommandOps:
  private type Result[A] = EitherT[ConnectionIO, AppError, A]
  private final case class TitleState(
      inputRevision: Long,
      generation: Long,
      currentBasisId: Option[String],
      previousBasisId: Option[String],
      activeOperationId: Option[String],
  )
  private final case class Candidate(id: String, basisId: Option[String], status: String)
  private final case class Preview(
      id: String,
      candidateId: String,
      beforeBasisId: Option[String],
      inputRevision: Long,
      status: String,
  )
  final case class FreshIds(operation: String, candidate: String, preview: String)

  def request(
      command: SeriesPlayerRadarCommand,
      requestedBy: AccountId,
      keyHash: String,
      fingerprint: String,
      ids: FreshIds,
  ): ConnectionIO[Either[AppError, SeriesPlayerRadarOperation]] =
    // This lock precedes title locks and protects keys reused across different titles as well.
    sql"SELECT pg_advisory_xact_lock(hashtext(${requestedBy.value}), 29)".query[Unit].unique *>
      (fr"SELECT request_fingerprint," ++ PostgresSeriesPlayerRadarReadOps.operationColumns ++ fr"""
        FROM series_radar_operations
        WHERE requested_by = $requestedBy AND idempotency_key_hash = $keyHash
      """).query[(String, SeriesPlayerRadarOperation)].option.flatMap {
        case Some((saved, operation)) if saved == fingerprint => operation.asRight.pure[ConnectionIO]
        case Some(_) => AppError.IdempotencyPayloadMismatch(
            "Idempotency-Key was reused for a different radar operation."
          ).asLeft[SeriesPlayerRadarOperation].pure[ConnectionIO]
        case None => (for
            state <- lockTitle(command.gameTitleId)
            acceptedAt <- EitherT.liftF(sql"SELECT now()".query[Instant].unique)
            operation <- accept(command, state, requestedBy, keyHash, fingerprint, ids, acceptedAt, None)
          yield operation).value
      }

  private def lockTitle(title: GameTitleId): Result[TitleState] = for
    revision <- EitherT.fromOptionF(
      sql"SELECT input_revision FROM series_analysis_title_states WHERE game_title_id = $title FOR UPDATE"
        .query[Long].option,
      AppError.NotFound("game title", title.value),
    )
    _ <- EitherT.liftF(sql"""
      INSERT INTO series_radar_title_states (game_title_id)
      VALUES ($title) ON CONFLICT (game_title_id) DO NOTHING
    """.update.run)
    state <- EitherT.liftF(sql"""
      SELECT generation, current_basis_id, previous_basis_id, active_operation_id
      FROM series_radar_title_states WHERE game_title_id = $title FOR UPDATE
    """.query[(Long, Option[String], Option[String], Option[String])].unique)
  yield TitleState(revision, state._1, state._2, state._3, state._4)

  private def accept(
      command: SeriesPlayerRadarCommand,
      state: TitleState,
      account: AccountId,
      keyHash: String,
      fingerprint: String,
      ids: FreshIds,
      at: Instant,
      origin: Option[String],
  ): Result[SeriesPlayerRadarOperation] =
    command.kind match
      case SeriesPlayerRadarOperationKind.Candidate => createCandidate(command, state, account, keyHash, fingerprint, ids, at, origin)
      case SeriesPlayerRadarOperationKind.Preview => createPreview(command, state, account, keyHash, fingerprint, ids, at, origin)
      case SeriesPlayerRadarOperationKind.Apply => applyCandidate(command, state, account, keyHash, fingerprint, ids, at, origin)
      case SeriesPlayerRadarOperationKind.Withdraw => withdraw(command, state, account, keyHash, fingerprint, ids, at)
      case SeriesPlayerRadarOperationKind.Restore => restore(command, state, account, keyHash, fingerprint, ids, at, origin)
      case SeriesPlayerRadarOperationKind.Acknowledge => acknowledge(command, account, keyHash, fingerprint, ids, at)
      case SeriesPlayerRadarOperationKind.Retry => retry(command, state, account, keyHash, fingerprint, ids, at)

  private def noActivePreparation(title: GameTitleId): Result[Unit] = for
    active <- EitherT.liftF(sql"""
      SELECT EXISTS(SELECT 1 FROM series_radar_operations
        WHERE game_title_id = $title AND status IN ('pending', 'running'))
    """.query[Boolean].unique)
    _ <- require(!active, "Another radar operation is already in progress. Refresh its state.")
  yield ()

  private def createCandidate(
      command: SeriesPlayerRadarCommand,
      state: TitleState,
      account: AccountId,
      keyHash: String,
      fingerprint: String,
      ids: FreshIds,
      at: Instant,
      origin: Option[String],
  ): Result[SeriesPlayerRadarOperation] = for
    _ <- noActivePreparation(command.gameTitleId)
    unresolved <- EitherT.liftF(sql"""
      SELECT EXISTS(SELECT 1 FROM series_radar_candidates
        WHERE game_title_id = ${command.gameTitleId}
          AND status IN ('pending', 'ready', 'unavailable', 'failed')
          AND id IS DISTINCT FROM ${Option.when(origin.nonEmpty)(command.candidateId).flatten})
    """.query[Boolean].unique)
    _ <- require(!unresolved, "A radar candidate already exists. Review or withdraw it first.")
    _ <- require(state.activeOperationId.isEmpty, "A radar application is already in progress.")
    candidateId = command.candidateId.filter(_ => origin.nonEmpty).getOrElse(ids.candidate)
    _ <- prepareCandidate(candidateId, command.gameTitleId, None, at, origin.nonEmpty)
    operation <- insertOperation(command, account, keyHash, fingerprint, ids.operation, at,
      Some(candidateId), None, None, origin, "pending")
  yield operation

  private def createPreview(
      command: SeriesPlayerRadarCommand,
      state: TitleState,
      account: AccountId,
      keyHash: String,
      fingerprint: String,
      ids: FreshIds,
      at: Instant,
      origin: Option[String],
  ): Result[SeriesPlayerRadarOperation] = for
    _ <- noActivePreparation(command.gameTitleId)
    candidate <- readyCandidate(command.gameTitleId, command.candidateId)
    _ <- insertPreview(ids.preview, command.gameTitleId, candidate.id, state, at)
    operation <- insertOperation(command, account, keyHash, fingerprint, ids.operation, at,
      Some(candidate.id), Some(ids.preview), candidate.basisId, origin, "pending")
  yield operation

  private def applyCandidate(
      command: SeriesPlayerRadarCommand,
      state: TitleState,
      account: AccountId,
      keyHash: String,
      fingerprint: String,
      ids: FreshIds,
      at: Instant,
      origin: Option[String],
  ): Result[SeriesPlayerRadarOperation] = for
    _ <- noActivePreparation(command.gameTitleId)
    candidate <- readyCandidate(command.gameTitleId, command.candidateId)
    preview <- EitherT.fromOptionF(sql"""
      SELECT id, candidate_id, before_basis_id, input_revision, status
      FROM series_radar_previews
      WHERE id = ${command.previewId} AND game_title_id = ${command.gameTitleId}
      FOR UPDATE
    """.query[Preview].option, AppError.Conflict("The radar comparison is no longer available."))
    _ <- require(preview.candidateId == candidate.id && preview.status == "ready" &&
      preview.beforeBasisId == state.currentBasisId &&
      command.expectedCurrentBasisId == state.currentBasisId,
      "The radar comparison changed. Calculate and review the latest comparison before applying.")
    _ <- require(state.activeOperationId.isEmpty, "A radar application is already in progress.")
    _ <- require(candidate.basisId != state.currentBasisId, "This radar basis is already applied.")
    operation <- insertOperation(command, account, keyHash, fingerprint, ids.operation, at,
      Some(candidate.id), Some(preview.id), candidate.basisId, origin, "pending")
    _ <- EitherT.liftF(sql"""
      UPDATE series_radar_title_states
      SET desired_basis_id = ${candidate.basisId}, generation = generation + 1,
          active_operation_id = ${ids.operation}, updated_at = $at
      WHERE game_title_id = ${command.gameTitleId} AND generation = ${state.generation}
    """.update.run)
    _ <- markPending(command.gameTitleId)
  yield operation

  private def withdraw(
      command: SeriesPlayerRadarCommand,
      state: TitleState,
      account: AccountId,
      keyHash: String,
      fingerprint: String,
      ids: FreshIds,
      at: Instant,
  ): Result[SeriesPlayerRadarOperation] = for
    candidate <- candidateById(command.gameTitleId, command.candidateId)
    _ <- require(candidate.status != "applied", "This basis was already published. Compare the previous basis to restore it.")
    _ <- EitherT.liftF(sql"""
      UPDATE series_radar_candidates SET status = 'withdrawn', updated_at = $at
      WHERE id = ${candidate.id} AND game_title_id = ${command.gameTitleId}
    """.update.run)
    affected <- EitherT.liftF(sql"""
      UPDATE series_radar_operations SET status = 'withdrawn', finished_at = $at, updated_at = $at
      WHERE candidate_id = ${candidate.id} AND game_title_id = ${command.gameTitleId}
        AND status IN ('pending', 'running') RETURNING id
    """.query[String].to[List])
    _ <- EitherT.liftF(sql"""
      UPDATE series_radar_previews SET status = 'stale', updated_at = $at
      WHERE candidate_id = ${candidate.id} AND status IN ('pending', 'ready')
    """.update.run)
    _ <- if state.activeOperationId.exists(affected.contains) then
      EitherT.liftF(sql"""
        UPDATE series_radar_title_states
        SET desired_basis_id = current_basis_id, generation = generation + 1,
            active_operation_id = NULL, updated_at = $at
        WHERE game_title_id = ${command.gameTitleId} AND generation = ${state.generation}
      """.update.run) *> markPending(command.gameTitleId)
    else EitherT.rightT[ConnectionIO, AppError](())
    operation <- insertOperation(command, account, keyHash, fingerprint, ids.operation, at,
      Some(candidate.id), None, candidate.basisId, None, "succeeded")
  yield operation

  private def restore(
      command: SeriesPlayerRadarCommand,
      state: TitleState,
      account: AccountId,
      keyHash: String,
      fingerprint: String,
      ids: FreshIds,
      at: Instant,
      origin: Option[String],
  ): Result[SeriesPlayerRadarOperation] = for
    _ <- noActivePreparation(command.gameTitleId)
    _ <- require(command.expectedCurrentBasisId == state.currentBasisId,
      "The current radar basis changed. Refresh its state before restoring.")
    basis <- EitherT.fromOption[ConnectionIO](state.previousBasisId,
      AppError.Conflict("There is no previous radar basis to compare."))
    unresolved <- EitherT.liftF(sql"""
      SELECT EXISTS(SELECT 1 FROM series_radar_candidates
        WHERE game_title_id = ${command.gameTitleId}
          AND status IN ('pending', 'ready', 'unavailable', 'failed')
          AND id IS DISTINCT FROM ${Option.when(origin.nonEmpty)(command.candidateId).flatten})
    """.query[Boolean].unique)
    _ <- require(!unresolved, "Review or withdraw the existing radar candidate first.")
    candidateId = command.candidateId.filter(_ => origin.nonEmpty).getOrElse(ids.candidate)
    _ <- prepareCandidate(candidateId, command.gameTitleId, Some(basis), at, origin.nonEmpty)
    operation <- insertOperation(command, account, keyHash, fingerprint, ids.operation, at,
      Some(candidateId), None, Some(basis), origin, "pending")
  yield operation

  private def acknowledge(
      command: SeriesPlayerRadarCommand,
      account: AccountId,
      keyHash: String,
      fingerprint: String,
      ids: FreshIds,
      at: Instant,
  ): Result[SeriesPlayerRadarOperation] = for
    evidence <- EitherT.fromOption[ConnectionIO](command.evidenceKey,
      AppError.ValidationFailed("evidenceKey is required."))
    visible <- EitherT.liftF(sql"""
      SELECT EXISTS(SELECT 1 FROM series_radar_title_states r,
        LATERAL jsonb_array_elements(COALESCE(r.monitor->'reasons', '[]'::jsonb)) e
        WHERE r.game_title_id = ${command.gameTitleId} AND e->>'evidenceChecksum' = $evidence)
    """.query[Boolean].unique)
    _ <- require(visible, "The review evidence changed. Refresh the radar state.")
    _ <- EitherT.liftF(sql"""
      INSERT INTO series_radar_acknowledgements
        (game_title_id, evidence_key, requested_by, acknowledged_at)
      VALUES (${command.gameTitleId}, $evidence, $account, $at)
      ON CONFLICT (game_title_id, evidence_key) DO NOTHING
    """.update.run)
    operation <- insertOperation(command, account, keyHash, fingerprint, ids.operation, at,
      None, None, None, None, "succeeded")
  yield operation

  private def retry(
      command: SeriesPlayerRadarCommand,
      state: TitleState,
      account: AccountId,
      keyHash: String,
      fingerprint: String,
      ids: FreshIds,
      at: Instant,
  ): Result[SeriesPlayerRadarOperation] = for
    original <- EitherT.fromOptionF((fr"SELECT" ++ PostgresSeriesPlayerRadarReadOps.operationColumns ++ fr"""
      FROM series_radar_operations
      WHERE id = ${command.originOperationId} AND game_title_id = ${command.gameTitleId}
      FOR UPDATE
    """).query[SeriesPlayerRadarOperation].option,
      AppError.Conflict("The original radar operation is no longer available."))
    _ <- require(original.status == "failed", "Only a confirmed failed operation can be retried.")
    kind <- EitherT.fromOption[ConnectionIO](SeriesPlayerRadarOperationKind.fromWire(original.kind),
      AppError.Conflict("This radar operation cannot be retried."))
    _ <- require(Set("candidate", "preview", "apply", "restore").contains(original.kind),
      "This radar operation cannot be retried.")
    _ <- require(original.kind != "restore" || original.basisId == state.previousBasisId,
      "The previous radar basis changed. Refresh its comparison before retrying.")
    before <- original.previewId.traverse(id => EitherT.liftF(sql"""
      SELECT before_basis_id FROM series_radar_previews WHERE id = $id
    """.query[Option[String]].option)).map(_.flatten.flatten)
    retryCommand = command.copy(kind = kind, candidateId = original.candidateId,
      previewId = original.previewId,
      expectedCurrentBasisId = if kind == SeriesPlayerRadarOperationKind.Apply then before else state.currentBasisId,
      originOperationId = None)
    result <- accept(retryCommand, state, account, keyHash, fingerprint, ids, at, Some(original.operationId))
  yield result

  private def candidateById(title: GameTitleId, id: Option[String]): Result[Candidate] =
    EitherT.fromOptionF(sql"""
      SELECT id, basis_id, status FROM series_radar_candidates
      WHERE game_title_id = $title AND id = $id FOR UPDATE
    """.query[Candidate].option, AppError.Conflict("The radar candidate is no longer available."))

  private def readyCandidate(title: GameTitleId, id: Option[String]): Result[Candidate] = for
    candidate <- candidateById(title, id)
    _ <- require(candidate.status == "ready" && candidate.basisId.nonEmpty,
      "The radar candidate is not ready. Refresh its state and comparison.")
    compatible <- EitherT.liftF(sql"""
      SELECT EXISTS(SELECT 1 FROM series_radar_bases
        WHERE id = ${candidate.basisId} AND game_title_id = $title
          AND payload->>'definitionVersion' = 'player-radar-six-axes-v1'
          AND payload->>'methodVersion' = 'player-radar-spread-v1')
    """.query[Boolean].unique)
    _ <- require(compatible, "The radar definition changed. Create a new candidate.")
  yield candidate

  private def insertCandidate(id: String, title: GameTitleId, basis: Option[String], at: Instant)
      : Result[Unit] = EitherT.liftF(sql"""
    INSERT INTO series_radar_candidates
      (id, game_title_id, basis_id, status, created_at, updated_at)
    VALUES ($id, $title, $basis, 'pending', $at, $at)
  """.update.run.void)

  private def prepareCandidate(id: String, title: GameTitleId, basis: Option[String], at: Instant,
      retrying: Boolean): Result[Unit] =
    if !retrying then insertCandidate(id, title, basis, at)
    else for
      candidate <- candidateById(title, Some(id))
      _ <- require(candidate.status == "failed", "Only a failed candidate can be retried.")
      _ <- EitherT.liftF(sql"""
        UPDATE series_radar_candidates
        SET status = 'pending', basis_id = $basis, result = NULL,
            safe_failure_code = NULL, updated_at = $at
        WHERE id = $id AND game_title_id = $title
      """.update.run)
    yield ()

  private def insertPreview(id: String, title: GameTitleId, candidate: String, state: TitleState, at: Instant)
      : Result[Unit] = EitherT.liftF(sql"""
    INSERT INTO series_radar_previews
      (id, game_title_id, candidate_id, before_basis_id, input_revision, status, created_at, updated_at)
    VALUES ($id, $title, $candidate, ${state.currentBasisId}, ${state.inputRevision}, 'pending', $at, $at)
  """.update.run.void)

  private def insertOperation(
      command: SeriesPlayerRadarCommand,
      account: AccountId,
      keyHash: String,
      fingerprint: String,
      id: String,
      at: Instant,
      candidateId: Option[String],
      previewId: Option[String],
      basisId: Option[String],
      origin: Option[String],
      status: String,
  ): Result[SeriesPlayerRadarOperation] =
    val finished = Option.when(status == "succeeded")(at)
    EitherT.liftF(sql"""
      INSERT INTO series_radar_operations
        (id, game_title_id, kind, status, candidate_id, preview_id, basis_id,
         origin_operation_id, requested_by, idempotency_key_hash, request_fingerprint,
         requested_at, finished_at, updated_at)
      VALUES ($id, ${command.gameTitleId}, ${command.kind.wire}, $status,
        $candidateId, $previewId, $basisId, $origin, $account, $keyHash, $fingerprint,
        $at, $finished, $at)
    """.update.run).as(SeriesPlayerRadarOperation(id, command.gameTitleId, command.kind.wire,
      status, candidateId, previewId, basisId, origin, None, at, finished))

  private def markPending(title: GameTitleId): Result[Unit] = EitherT.liftF(sql"""
    UPDATE series_analysis_title_states SET pending_work = true, updated_at = now()
    WHERE game_title_id = $title
  """.update.run *> sql"""
    UPDATE series_analysis_jobs SET updated_at = now()
    WHERE game_title_id = $title AND status = 'queued' AND work_kind = 'analysis'
  """.update.run.void)

  private def require(condition: Boolean, detail: String): Result[Unit] =
    EitherT.cond[ConnectionIO](condition, (), AppError.Conflict(detail))
