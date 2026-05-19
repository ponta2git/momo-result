package momo.api.repositories

import cats.Applicative

trait QueueProducer[F[_]]:
  def publish(payload: OcrQueuePayload): F[String]
  def ping: F[Unit]

trait QueueHealthProbe[F[_]]:
  def ping: F[Unit]
  def deadLetterLength: F[Long]

object QueueHealthProbe:
  def healthy[F[_]: Applicative]: QueueHealthProbe[F] = new QueueHealthProbe[F]:
    override def ping: F[Unit] = Applicative[F].unit
    override def deadLetterLength: F[Long] = Applicative[F].pure(0L)
