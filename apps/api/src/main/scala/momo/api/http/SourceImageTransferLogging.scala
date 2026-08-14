package momo.api.http

import cats.effect.Async
import fs2.Stream
import org.slf4j.LoggerFactory

/**
 * Immutable context carried from request decoding to lazy body finalization.
 *
 * Keeping correlation and safe domain fields as data avoids depending on handler-scoped MDC when
 * the body is pulled later or on another thread.
 */
private[api] final case class SourceImageTransferContext(
    requestId: String,
    event: String,
    fields: String,
)

private[api] object SourceImageTransferLogging:
  private val logger = LoggerFactory.getLogger("momo.api.http.SourceImageTransferLogging")

  def observe[F[_]: Async](
      body: Stream[F, Byte],
      context: SourceImageTransferContext,
  ): Stream[F, Byte] = BodyTransferObserver(body)(result =>
    RequestIdMiddleware.logWithMdc[F](context.requestId) {
      val message = render(context, result)
      result.outcome match
        case BodyTransferOutcome.Succeeded => logger.info(message)
        case BodyTransferOutcome.Errored | BodyTransferOutcome.Canceled => logger.warn(message)
    }
  )

  private def render(
      context: SourceImageTransferContext,
      result: BodyTransferResult,
  ): String =
    s"${context.event} requestId=${context.requestId} ${context.fields} " +
      s"outcome=${result.outcome.wire} bodyBytes=${result.bodyBytes.toString} " +
      s"errorClass=${result.errorClass.getOrElse("none")} durationMs=${result.duration.toMillis}"
