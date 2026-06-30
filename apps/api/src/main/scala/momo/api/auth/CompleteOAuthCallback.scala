package momo.api.auth

import cats.effect.Sync
import cats.syntax.all.*
import org.slf4j.LoggerFactory

import momo.api.errors.AppError

final case class OAuthCallbackInput(
    code: Option[String],
    state: Option[String],
    cookieState: Option[String],
    providerError: Option[String],
)

sealed trait OAuthCallbackDecision

object OAuthCallbackDecision:
  final case class Completed(redirectPath: String, session: CreatedSession)
      extends OAuthCallbackDecision
  final case class ProviderDeniedSilent(redirectPath: Option[String]) extends OAuthCallbackDecision
  final case class Rejected(reason: String, error: AppError) extends OAuthCallbackDecision

final class CompleteOAuthCallback[F[_]: Sync](
    stateCodec: OAuthStateCodec[F],
    completeOAuthLogin: CompleteOAuthLogin[F],
    callbackStateRateLimiter: RateLimiter[F],
    fallbackRedirectPath: String,
):
  private val logger = LoggerFactory.getLogger("momo.api.auth.CompleteOAuthCallback")

  def run(input: OAuthCallbackInput): F[OAuthCallbackDecision] = matchingState(input) match
    case None =>
      rejected(
        "state_mismatch",
        AppError.Forbidden("OAuth callback is missing or has mismatched state.")
      )
        .pure[F]
    case Some(stateValue) =>
      authorizeStateReplay(stateValue).flatMap {
        case Some(rejection) => rejection.pure[F]
        case None => validateState(stateValue).flatMap {
            case None =>
              rejected(
                "state_invalid_or_expired",
                AppError.Forbidden("OAuth state is invalid or expired.")
              )
                .pure[F]
            case Some(context) => decideWithValidState(input, context)
          }
      }

  private def matchingState(input: OAuthCallbackInput): Option[String] =
    (input.state, input.cookieState) match
      case (Some(stateValue), Some(cookieValue)) if stateValue == cookieValue => Some(stateValue)
      case _ => None

  private def authorizeStateReplay(stateValue: String): F[Option[OAuthCallbackDecision.Rejected]] =
    SessionTokenHash.sha256[F](stateValue).flatMap { stateHash =>
      callbackStateRateLimiter.allow(stateHash).map {
        case true => None
        case false =>
          Some(rejected(
            "callback_state_rate_limited",
            AppError.TooManyRequests("Too many OAuth callback attempts. Start login again."),
          ))
      }
    }

  private def validateState(stateValue: String): F[Option[stateCodec.Payload]] =
    stateCodec.validate(stateValue)

  private def decideWithValidState(
      input: OAuthCallbackInput,
      context: stateCodec.Payload,
  ): F[OAuthCallbackDecision] = input.providerError match
    case Some(_) if context.silent =>
      Sync[F].delay(logger.warn("auth_callback_rejected reason=provider_denied_silent")) *>
        OAuthCallbackDecision.ProviderDeniedSilent(context.redirectPath).pure[F]
    case Some(_) =>
      rejected("provider_denied", AppError.Forbidden("Discord OAuth was cancelled or denied."))
        .pure[F]
    case None => input.code match
        case None =>
          rejected(
            "missing_code",
            AppError.Forbidden("OAuth callback is missing or has mismatched state.")
          )
            .pure[F]
        case Some(codeValue) => completeOAuthLogin.run(codeValue).map {
            case Left(failure) => rejected(failure.reason, failure.error)
            case Right(completion) =>
              OAuthCallbackDecision.Completed(
                context.redirectPath.getOrElse(fallbackRedirectPath),
                completion.session,
              )
          }

  private def rejected(reason: String, error: AppError): OAuthCallbackDecision.Rejected =
    OAuthCallbackDecision.Rejected(reason, error)
