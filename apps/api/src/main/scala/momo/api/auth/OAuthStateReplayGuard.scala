package momo.api.auth

import java.time.Instant

import cats.effect.{Ref, Sync}
import cats.syntax.all.*

/** Consumes a validated state exactly once for its entire signed lifetime. */
trait OAuthStateReplayGuard[F[_]]:
  def consume(stateHash: String, expiresAt: Instant): F[Boolean]

final class InMemoryOAuthStateReplayGuard[F[_]: Sync] private (
    used: Ref[F, Map[String, Instant]],
    now: F[Instant],
    maxKeys: Int,
) extends OAuthStateReplayGuard[F]:
  override def consume(stateHash: String, expiresAt: Instant): F[Boolean] = now.flatMap { current =>
    used.modify { previous =>
      val active = previous.filter { case (_, expiry) => expiry.isAfter(current) }
      if !expiresAt.isAfter(current) || active.contains(stateHash) || active.size >= maxKeys then
        active -> false
      else active.updated(stateHash, expiresAt) -> true
    }
  }

object InMemoryOAuthStateReplayGuard:
  def create[F[_]: Sync](now: F[Instant]): F[InMemoryOAuthStateReplayGuard[F]] =
    create(now, maxKeys = 10000)

  def create[F[_]: Sync](
      now: F[Instant],
      maxKeys: Int,
  ): F[InMemoryOAuthStateReplayGuard[F]] =
    if maxKeys <= 0 then
      Sync[F].raiseError(new IllegalArgumentException("OAuth state capacity must be positive"))
    else
      Ref.of[F, Map[String, Instant]](Map.empty)
        .map(new InMemoryOAuthStateReplayGuard(_, now, maxKeys))
