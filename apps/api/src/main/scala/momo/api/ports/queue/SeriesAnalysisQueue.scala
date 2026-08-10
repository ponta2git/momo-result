package momo.api.ports.queue

trait SeriesAnalysisQueuePublisher[F[_]]:
  def publish(jobId: String): F[String]
