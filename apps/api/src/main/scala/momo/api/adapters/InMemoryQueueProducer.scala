package momo.api.adapters

import cats.effect.{Ref, Sync}
import cats.syntax.functor.*

import momo.api.repositories.{OcrQueuePayload, QueueProducer}

final class InMemoryQueueProducer[F[_]: Sync] private (ref: Ref[F, Vector[OcrQueuePayload]])
    extends QueueProducer[F]:
  override def publish(payload: OcrQueuePayload): F[String] = ref
    .modify(published => (published :+ payload, s"in-memory-${published.size + 1}"))
  override def ping: F[Unit] = Sync[F].unit

  def published: F[Vector[OcrQueuePayload]] = ref.get

object InMemoryQueueProducer:
  def create[F[_]: Sync]: F[InMemoryQueueProducer[F]] = Ref
    .of[F, Vector[OcrQueuePayload]](Vector.empty).map(new InMemoryQueueProducer(_))
