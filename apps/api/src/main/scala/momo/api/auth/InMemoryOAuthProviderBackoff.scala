package momo.api.auth

import java.time.Instant

import cats.effect.{Ref, Sync}
import cats.syntax.all.*

import momo.api.errors.AppError

final class InMemoryOAuthProviderBackoff[F[_]: Sync] private (
    ref: Ref[F, InMemoryOAuthProviderBackoff.State],
    failureThreshold: Int,
    backoff: scala.concurrent.duration.FiniteDuration,
    now: F[Instant],
) extends OAuthProviderBackoff[F]:
  import InMemoryOAuthProviderBackoff.State

  override def isBlocked: F[Boolean] = now.flatMap { current =>
    ref.modify { state =>
      state.blockedUntil match
        case Some(until) if until.isAfter(current) => state -> true
        case Some(_) => State.empty -> false
        case None => state -> false
    }
  }

  override def recordFailure(error: AppError): F[Boolean] = error match
    case _: AppError.DependencyFailed => now.flatMap { current =>
        ref.modify { state =>
          val activeState = state.blockedUntil match
            case Some(until) if until.isAfter(current) => state
            case Some(_) => State.empty
            case None => state
          val nextFailures = activeState.failures + 1
          if nextFailures >= failureThreshold then
            State(0, Some(current.plusSeconds(backoff.toSeconds))) -> true
          else activeState.copy(failures = nextFailures) -> false
        }
      }
    case _ => recordSuccess.as(false)

  override def recordSuccess: F[Unit] = ref.set(State.empty)

object InMemoryOAuthProviderBackoff:
  final case class State(failures: Int, blockedUntil: Option[Instant])
  object State:
    val empty: State = State(0, None)

  def create[F[_]: Sync](
      failureThreshold: Int,
      backoff: scala.concurrent.duration.FiniteDuration,
      now: F[Instant],
  ): F[InMemoryOAuthProviderBackoff[F]] = Ref.of[F, State](State.empty)
    .map(InMemoryOAuthProviderBackoff(_, failureThreshold, backoff, now))
