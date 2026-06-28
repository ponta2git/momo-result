package momo.api.config

import scala.concurrent.duration.*

import cats.MonadThrow
import cats.syntax.all.*

private[config] object AuthConfigLoader:
  def load[F[_]: MonadThrow](env: Map[String, String], appEnv: AppEnv): F[AuthConfig] =
    (
      ConfigParsers.parsePositiveLong(env, "SESSION_TTL_DAYS", default = 30L),
      ConfigParsers.parsePositiveLong(env, "OAUTH_STATE_TTL_SECONDS", default = 300L),
      ConfigParsers.parseNonNegativeInt(env, "AUTH_RATE_LIMIT_PER_MINUTE", default = 10),
      ConfigParsers.parseNonNegativeInt(
        env,
        "AUTH_CALLBACK_STATE_RATE_LIMIT_PER_MINUTE",
        default = 3
      ),
      ConfigParsers.parsePositiveInt(env, "AUTH_PROVIDER_FAILURE_THRESHOLD", default = 3),
      ConfigParsers.parsePositiveLong(env, "AUTH_PROVIDER_BACKOFF_SECONDS", default = 60L),
      ConfigParsers.parseBoolean(env, "AUTH_COOKIE_SECURE", default = appEnv == AppEnv.Prod),
      ConfigParsers.parseBoolean(env, "AUTH_COOKIE_HOST_PREFIX", default = appEnv == AppEnv.Prod),
    ).mapN {
      (
          sessionTtlDays,
          stateTtlSeconds,
          rateLimit,
          callbackStateRateLimit,
          providerFailureThreshold,
          providerBackoffSeconds,
          secureCookies,
          hostPrefix,
      ) =>
        AuthConfig(
          discordClientId = env.get("DISCORD_CLIENT_ID").filter(_.nonEmpty),
          discordClientSecret = env.get("DISCORD_CLIENT_SECRET").filter(_.nonEmpty),
          discordRedirectUri = env.get("DISCORD_REDIRECT_URI").filter(_.nonEmpty),
          stateSigningKey = env.get("AUTH_STATE_SIGNING_KEY").filter(_.nonEmpty),
          sessionCookieName = env.getOrElse(
            "SESSION_COOKIE_NAME",
            if appEnv == AppEnv.Prod then "__Host-momo_result_session" else "momo_result_session",
          ),
          stateCookieName = env.getOrElse(
            "OAUTH_STATE_COOKIE_NAME",
            if appEnv == AppEnv.Prod then "__Host-momo_result_oauth_state"
            else "momo_result_oauth_state",
          ),
          sessionTtl = sessionTtlDays.days,
          stateTtl = stateTtlSeconds.seconds,
          rateLimitPerMinute = rateLimit,
          callbackStateRateLimitPerMinute = callbackStateRateLimit,
          providerFailureThreshold = providerFailureThreshold,
          providerBackoff = providerBackoffSeconds.seconds,
          callbackRedirectPath = env.getOrElse("AUTH_CALLBACK_REDIRECT_PATH", "/"),
          useSecureCookies = secureCookies,
          useHostPrefix = hostPrefix,
        )
    }.liftTo[F].flatMap(validateAuth[F](_, appEnv))

  private def validateAuth[F[_]: MonadThrow](config: AuthConfig, appEnv: AppEnv): F[AuthConfig] =
    val problems = if appEnv == AppEnv.Prod then prodAuthProblems(config) else Nil
    if problems.nonEmpty then
      MonadThrow[F]
        .raiseError(new IllegalArgumentException(s"Invalid production auth config: ${problems
            .mkString(", ")}"))
    else MonadThrow[F].pure(config)

  private def prodAuthProblems(config: AuthConfig): List[String] =
    val missing = List(
      "DISCORD_CLIENT_ID" -> config.discordClientId,
      "DISCORD_CLIENT_SECRET" -> config.discordClientSecret,
      "DISCORD_REDIRECT_URI" -> config.discordRedirectUri,
      "AUTH_STATE_SIGNING_KEY" -> config.stateSigningKey,
    ).collect { case (name, None) => s"$name is required" }
    val secureCookie = Option.when(!config.useSecureCookies)("AUTH_COOKIE_SECURE must be true")
    val hostPrefixEnabled = Option
      .when(!config.useHostPrefix)("AUTH_COOKIE_HOST_PREFIX must be true")
    val hostPrefix = Option.when(
      config.useHostPrefix &&
        (!config.sessionCookieName.startsWith("__Host-") ||
          !config.stateCookieName.startsWith("__Host-"))
    )("AUTH_COOKIE_HOST_PREFIX requires __Host- session and OAuth state cookie names")
    val redirect = Option.when(!RedirectPath.isSafe(config.callbackRedirectPath))(
      "AUTH_CALLBACK_REDIRECT_PATH must be a root-relative path"
    )
    missing ++ List(secureCookie, hostPrefixEnabled, hostPrefix, redirect).flatten
