package momo.api.adapters

import cats.effect.Ref
import cats.effect.Sync
import cats.syntax.functor.*
import momo.api.repositories.QueueProducer

final class InMemoryQueueProducer[F[_]: Sync] private (
    ref: Ref[F, Vector[OcrStreamPayload]]
) extends QueueProducer[F]:
  override def publish(payload: OcrStreamPayload): F[Unit] =
    ref.update(_ :+ payload)

  def published: F[Vector[OcrStreamPayload]] =
    ref.get

object InMemoryQueueProducer:
  def create[F[_]: Sync]: F[InMemoryQueueProducer[F]] =
    Ref.of[F, Vector[OcrStreamPayload]](Vector.empty).map(new InMemoryQueueProducer(_))
