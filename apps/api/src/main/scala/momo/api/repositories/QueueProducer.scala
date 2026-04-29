package momo.api.repositories

import momo.api.adapters.OcrStreamPayload

trait QueueProducer[F[_]]:
  def publish(payload: OcrStreamPayload): F[Unit]
