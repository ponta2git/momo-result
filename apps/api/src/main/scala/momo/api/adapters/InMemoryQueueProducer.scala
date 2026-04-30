package momo.api.adapters

import cats.effect.{Ref, Sync}
import cats.syntax.functor.*
import momo.api.repositories.{OcrQueuePayload, QueueProducer}

final class InMemoryQueueProducer[F[_]] private (ref: Ref[F, Vector[OcrQueuePayload]])
    extends QueueProducer[F]:
  override def publish(payload: OcrQueuePayload): F[Unit] = ref.update(_ :+ payload)

  def published: F[Vector[OcrQueuePayload]] = ref.get

object InMemoryQueueProducer:
  def create[F[_]: Sync]: F[InMemoryQueueProducer[F]] = Ref
    .of[F, Vector[OcrQueuePayload]](Vector.empty).map(new InMemoryQueueProducer(_))
