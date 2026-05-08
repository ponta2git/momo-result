package momo.api.repositories

trait QueueProducer[F[_]]:
  def publish(payload: OcrQueuePayload): F[String]
  def ping: F[Unit]
