package momo.api.maintenance

import scala.concurrent.duration.*

import cats.effect.std.Supervisor
import cats.effect.syntax.all.*
import cats.effect.{Async, Deferred, Ref, Resource}
import cats.syntax.all.*
import io.circe.Json

/** Owns the live process barrier. A timeout changes the receipt, never the owned I/O. */
private[api] final class MaintenanceDrain[F[_]: Async] private (
    state: Ref[F, MaintenanceDrain.State],
    admissionSettled: Deferred[F, Unit],
    requestsSettled: Deferred[F, Unit],
    releaseAction: Deferred[F, F[Unit]],
    releaseStarted: Ref[F, Boolean],
    releaseSettled: Deferred[F, Either[Throwable, Unit]],
    supervisor: Supervisor[F],
    timeout: FiniteDuration,
):
  import MaintenanceDrain.*

  def admissionOpen: F[Boolean] = state.get.map(_.request.isEmpty)

  /** Classify under the same atomic gate that admits the request. */
  def acquireRequest(continuation: Boolean): F[Option[F[Unit]]] = Async[F].uncancelable { _ =>
    state.modify { current =>
      if current.request.exists(_.stage == Stage.All) ||
        (current.request.nonEmpty && !continuation)
      then current -> None
      else
        val isContinuation = current.request.nonEmpty
        val next =
          if isContinuation then current.copy(continuations = current.continuations + 1)
          else current.copy(requests = current.requests + 1)
        next -> Some(isContinuation)
    }.flatMap(_.traverse { continuation =>
      Ref.of[F, Boolean](false).map { released =>
        released.getAndSet(true).flatMap { alreadyReleased =>
          if alreadyReleased then Async[F].unit
          else
            state.update { current =>
              if continuation then current.copy(continuations = current.continuations - 1)
              else current.copy(requests = current.requests - 1)
            } *> signalSettled
        }
      }
    })
  }

  def setRelease(action: F[Unit]): F[Unit] = releaseAction.complete(action).void

  /** Resource finalization and the live drain share one completion, including failures. */
  def release: F[Unit] = Async[F].uncancelable { _ =>
    releaseStarted.getAndSet(true).flatMap { started =>
      if started then releaseSettled.get.flatMap(_.liftTo[F])
      else
        releaseAction.get.flatten.attempt
          .flatTap(releaseSettled.complete).flatMap(_.liftTo[F])
    }
  }

  def request(input: Request): F[Boolean] = Async[F].uncancelable { _ =>
    state.modify { current =>
      if current.request.exists(existing =>
          existing.cutoverId != input.cutoverId || existing.stopEpoch != input.stopEpoch ||
            (existing.stage == Stage.All && input.stage == Stage.Admission)
        )
      then current -> Option.empty[List[Stage]]
      else
        val startAdmission = current.admission == WriterStatus.Active
        val startAll = input.stage == Stage.All && current.runtime == WriterStatus.Active
        current.copy(
          request = Some(input),
          admission = if startAdmission then WriterStatus.Draining else current.admission,
          runtime = if startAll then WriterStatus.Draining else current.runtime,
        ) -> Some(
          List(Option.when(startAdmission)(Stage.Admission), Option.when(startAll)(Stage.All))
            .flatten
        )
    }.flatMap {
      case None => Async[F].pure(false)
      case Some(starting) => signalSettled *> starting.traverse_(observe).as(true)
    }
  }

  def snapshot: F[Json] = state.get.map { current =>
    val selected = List(current.admission) ++
      Option.when(current.request.exists(_.stage == Stage.All))(current.runtime)
    val phase =
      if current.request.isEmpty then "running"
      else if selected.contains(WriterStatus.Failed) then "failed"
      else if selected.contains(WriterStatus.TimedOut) then "timed_out"
      else if selected.forall(_ == WriterStatus.Drained) then "drained"
      else "draining"
    Json.obj(
      "consumer" -> Json.fromString("momo-result-api"),
      "scope" -> Json.fromString("process"),
      "cutoverId" -> current.request.fold(Json.Null)(r => Json.fromString(r.cutoverId)),
      "stopEpoch" -> current.request.fold(Json.Null)(r => Json.fromLong(r.stopEpoch)),
      "stage" -> current.request.fold(Json.Null)(r => Json.fromString(r.stage.wire)),
      "phase" -> Json.fromString(phase),
      "writers" -> Json.arr(
        writer("http_admission", Stage.Admission, current.admission),
        writer("http_continuations_and_runtime", Stage.All, current.runtime),
      ),
      "inFlight" -> Json.obj(
        "requests" -> Json.fromLong(current.requests),
        "continuations" -> Json.fromLong(current.continuations),
      ),
    )
  }

  private def signalSettled: F[Unit] = state.get.flatMap { current =>
    val admission = current.request.nonEmpty && current.requests == 0
    val all = current.request.exists(_.stage == Stage.All) &&
      current.requests == 0 && current.continuations == 0
    admissionSettled.complete(()).void.whenA(admission) *>
      requestsSettled.complete(()).void.whenA(all)
  }

  private def observe(stage: Stage): F[Unit] =
    val settle = stage match
      case Stage.Admission => admissionSettled.get
      case Stage.All => requestsSettled.get *> release
    supervisor.supervise {
      Resource.make(
        (Async[F].sleep(timeout) *> finish(stage, WriterStatus.TimedOut)).start
      )(_.cancel).use { _ =>
        settle.attempt.flatMap(result =>
          finish(stage, result.fold(_ => WriterStatus.Failed, _ => WriterStatus.Drained))
        )
      }
    }.void

  private def finish(stage: Stage, status: WriterStatus): F[Unit] = state.update { current =>
    stage match
      case Stage.Admission if current.admission == WriterStatus.Draining =>
        current.copy(admission = status)
      case Stage.All if current.runtime == WriterStatus.Draining => current.copy(runtime = status)
      case _ => current
  }

private[api] object MaintenanceDrain:
  enum Stage(val wire: String) derives CanEqual:
    case Admission extends Stage("admission")
    case All extends Stage("all")

  final case class Request(cutoverId: String, stopEpoch: Long, stage: Stage)

  private enum WriterStatus(val wire: String) derives CanEqual:
    case Active extends WriterStatus("active")
    case Draining extends WriterStatus("draining")
    case Drained extends WriterStatus("drained")
    case TimedOut extends WriterStatus("timed_out")
    case Failed extends WriterStatus("failed")

  private final case class State(
      request: Option[Request] = None,
      requests: Long = 0,
      continuations: Long = 0,
      admission: WriterStatus = WriterStatus.Active,
      runtime: WriterStatus = WriterStatus.Active,
  )

  def resource[F[_]: Async](): Resource[F, MaintenanceDrain[F]] = resource(20.seconds)

  def resource[F[_]: Async](timeout: FiniteDuration): Resource[F, MaintenanceDrain[F]] =
    for
      supervisor <- Supervisor[F]
      state <- Resource.eval(Ref.of[F, State](State()))
      admission <- Resource.eval(Deferred[F, Unit])
      requests <- Resource.eval(Deferred[F, Unit])
      release <- Resource.eval(Deferred[F, F[Unit]])
      started <- Resource.eval(Ref.of[F, Boolean](false))
      settled <- Resource.eval(Deferred[F, Either[Throwable, Unit]])
    yield new MaintenanceDrain(
      state,
      admission,
      requests,
      release,
      started,
      settled,
      supervisor,
      timeout
    )

  def parse(json: Json): Option[Request] =
    for
      obj <- json.asObject
      _ <- Option.when(obj.keys.toSet == Set("cutoverId", "stopEpoch", "stage"))((): Unit)
      id <- obj("cutoverId").flatMap(_.asString)
      _ <- Option.when(id.matches("[A-Za-z0-9][A-Za-z0-9_-]{0,63}"))((): Unit)
      epoch <- obj("stopEpoch").flatMap(_.asNumber).flatMap(_.toLong)
      _ <- Option.when(epoch > 0 && epoch <= 9007199254740991L)((): Unit)
      rawStage <- obj("stage").flatMap(_.asString)
      stage <- Stage.values.find(_.wire == rawStage)
    yield Request(id, epoch, stage)

  private def writer(name: String, stage: Stage, status: WriterStatus): Json =
    val failure = status match
      case WriterStatus.TimedOut => List("failure" -> Json.fromString("drain_timeout"))
      case WriterStatus.Failed => List("failure" -> Json.fromString("drain_failed"))
      case _ => Nil
    Json.obj((List(
      "name" -> Json.fromString(name),
      "stage" -> Json.fromString(stage.wire),
      "status" -> Json.fromString(status.wire),
    ) ++ failure)*)
