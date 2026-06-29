package momo.api.adapters

import cats.effect.{Ref, Sync}
import cats.syntax.functor.*

import momo.api.ports.queue.{OcrJobEnqueueRequest, OcrJobQueuePublisher}

final class InMemoryOcrJobQueuePublisher[F[_]] private (
    ref: Ref[F, Vector[OcrJobEnqueueRequest]]
) extends OcrJobQueuePublisher[F]:
  override def publish(request: OcrJobEnqueueRequest): F[String] = ref
    .modify(published => (published :+ request, s"in-memory-${published.size + 1}"))

  def published: F[Vector[OcrJobEnqueueRequest]] = ref.get

object InMemoryOcrJobQueuePublisher:
  def create[F[_]: Sync]: F[InMemoryOcrJobQueuePublisher[F]] = Ref
    .of[F, Vector[OcrJobEnqueueRequest]](Vector.empty).map(new InMemoryOcrJobQueuePublisher(_))
