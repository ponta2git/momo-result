package momo.api.config

import cats.effect.IO
import cats.syntax.all.*

import momo.api.MomoCatsEffectSuite

final class IngressConfigSpec extends MomoCatsEffectSuite:
  private val credential = "test-only-origin-credential-32-bytes"
  private val environment = Map(
    "MOMO_CANONICAL_HOST" -> "EXAMPLE.com.",
    "MOMO_EXTRA_ALLOWED_HOSTS" -> " origin.example.com,example.com ",
    "MOMO_ORIGIN_LOCK_TOKEN" -> credential,
  )

  test("production validates all ingress configuration before serving without exposing it"):
    val invalid = List(
      Map.empty[String, String],
      environment - "MOMO_CANONICAL_HOST",
      environment - "MOMO_ORIGIN_LOCK_TOKEN",
      environment + ("MOMO_ORIGIN_LOCK_TOKEN" -> "short"),
      environment + ("MOMO_ORIGIN_LOCK_TOKEN" -> (credential + "\n")),
      environment + ("MOMO_CANONICAL_HOST" -> "example.com/path"),
      environment + ("MOMO_EXTRA_ALLOWED_HOSTS" -> "*.example.com"),
      environment + ("MOMO_EXTRA_ALLOWED_HOSTS" -> "example.com:8080"),
    )
    invalid.traverse_(env =>
      IngressConfig.load[IO](env, AppEnv.Prod).attempt.map { result =>
        assert(result.isLeft)
        assert(result.left.forall(error => !error.toString.contains(credential)))
      }
    ) *> IngressConfig.load[IO](environment, AppEnv.Prod).map { result =>
      val config = result.getOrElse(fail("missing ingress configuration"))
      assertEquals(config.allowedHosts, Set("example.com", "origin.example.com"))
      assert(config.acceptsToken(credential))
      assert(!config.acceptsToken(credential + "other"))
      assert(!config.toString.contains(credential))
      assert(!config.toString.contains("example.com"))
    }

  test("local development is opt-out only when no ingress settings were supplied"):
    for
      absent <- IngressConfig.load[IO](Map.empty, AppEnv.Dev)
      partial <-
        IngressConfig.load[IO](Map("MOMO_CANONICAL_HOST" -> "localhost"), AppEnv.Test).attempt
      enabled <- IngressConfig.load[IO](environment, AppEnv.Test)
    yield
      assert(absent.isEmpty)
      assert(partial.isLeft)
      assert(enabled.nonEmpty)
