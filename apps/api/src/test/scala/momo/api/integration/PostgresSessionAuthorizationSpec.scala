package momo.api.integration

import cats.effect.IO
import cats.syntax.all.*
import doobie.implicits.*
import io.circe.Json
import org.http4s.circe.*
import org.http4s.implicits.*
import org.http4s.{Header, HttpApp, Method, Request, Status, Uri}
import org.typelevel.ci.CIString

import momo.api.adapters.postgres.{PostgresAppSessionsRepository, PostgresMeta}
import momo.api.auth.{SessionCookieCodec, SessionTokenHash}
import momo.api.bootstrap.ApiApp
import momo.api.config.{AppConfig, AppEnv, AuthConfig}
import momo.api.domain.ids.{AccountId, GameTitleId, UserId}
import momo.api.domain.{AccountRole, GameTitle, LoginAccount}
import momo.api.http.HttpAssertions.{assertProblem, jsonField}
import momo.api.repositories.CreateLoginAccountData

import PostgresMeta.given

final class PostgresSessionAuthorizationSpec extends IntegrationSuite:
  private val subjectId = AccountId.unsafeFromString("account_role_session_subject")
  private val titleId = GameTitleId.unsafeFromString("title_role_session")
  private val authConfig = AuthConfig.defaults(AppEnv.Prod)
  private val accountUri = Uri.unsafeFromString(s"/api/admin/login-accounts/${subjectId.value}")
  private val recalculationUri = uri"/api/admin/series-analysis/recalculations"
  private val radarOperationUri = uri"/api/admin/series-analysis/radar/operations"
  private val titleBody = Json.obj("gameTitleId" -> Json.fromString(titleId.value))
  private val candidateBody = titleBody.mapObject(_.add("kind", Json.fromString("candidate")))
  private val mapBody = Json.obj(
    "id" -> Json.fromString("map_role_session"),
    "gameTitleId" -> Json.fromString(titleId.value),
    "name" -> Json.fromString("Session role map"),
  )

  private final case class Credentials(cookie: String, csrfToken: String, idHash: String)
  private final case class SessionApp(
      app: HttpApp[IO],
      backgroundFailure: IO[Nothing],
      administrator: Credentials,
      subject: Credentials,
  )
  private final case class SavedActivity(
      maps: List[(String, String)],
      analysisRequests: List[(String, String)],
      analysisJobs: List[(String, String)],
      analysisJobRequests: List[(String, Option[String], String)],
      candidates: List[(String, String)],
      radarOperations: List[(String, String, Option[String])],
      idempotencyKeys: Int,
  )

  test("one database session follows promotion, demotion and disabling before idempotency replay"):
    withSessionApp(AccountRole.User) { fixture =>
      val createMap = mutation(
        Method.POST,
        uri"/api/map-masters",
        fixture.subject,
        "session-map",
        mapBody,
      )
      val recalculate = mutation(
        Method.POST,
        recalculationUri,
        fixture.subject,
        "session-analysis",
        titleBody,
      )
      val createCandidate = mutation(
        Method.POST,
        radarOperationUri,
        fixture.subject,
        "session-radar",
        candidateBody,
      )
      for
        _ <- assertCurrentRole(fixture, AccountRole.User)
        _ <- forbidden(fixture, createMap)
        initially <- savedActivity
        _ = assertEquals(initially.maps, Nil)
        _ = assertEquals(initially.idempotencyKeys, 0)
        _ <- updateAccount(
          fixture,
          fixture.administrator,
          "promote-subject",
          Json.obj("role" -> Json.fromString("operator")),
        )
        _ <- assertCurrentRole(fixture, AccountRole.Operator)
        _ <- successfulJson(fixture, createMap, Status.Ok)
        analysis <- successfulJson(fixture, recalculate, Status.Accepted)
        candidate <- successfulJson(fixture, createCandidate, Status.Accepted)
        accepted <- savedActivity
        _ =
          val requestId = jsonField[String](analysis, "requestId")
          val target = jsonField[Json](analysis, "target")
          val jobId = jsonField[String](target, "jobId")
          val candidateId = jsonField[String](candidate, "candidateId")
          val operationId = jsonField[String](candidate, "operationId")
          assertEquals(jsonField[Int](analysis, "targetCount"), 1)
          assertEquals(jsonField[String](target, "gameTitleId"), titleId.value)
          assertEquals(accepted.maps, List(("map_role_session", "Session role map")))
          assertEquals(accepted.analysisRequests, List((requestId, "pending")))
          assertEquals(accepted.analysisJobs, List((jobId, "queued")))
          assertEquals(accepted.analysisJobRequests, List((requestId, Some(jobId), "pending")))
          assertEquals(accepted.candidates, List((candidateId, "pending")))
          assertEquals(accepted.radarOperations, List((operationId, "pending", Some(candidateId))))
          assertEquals(accepted.idempotencyKeys, 3)
        _ <- updateAccount(
          fixture,
          fixture.administrator,
          "demote-subject",
          Json.obj("role" -> Json.fromString("user")),
        )
        _ <- assertCurrentRole(fixture, AccountRole.User)
        _ <- assertSessionExists(fixture.subject, expected = true)
        _ <- List(createMap, recalculate, createCandidate).traverse_(forbidden(fixture, _))
        _ <- forbidden(
          fixture,
          mutation(Method.POST, recalculationUri, fixture.subject, "denied-new-key", titleBody),
        )
        afterDemotion <- savedActivity
        _ = assertEquals(afterDemotion, accepted)
        _ <- updateAccount(
          fixture,
          fixture.administrator,
          "disable-subject",
          Json.obj("loginEnabled" -> Json.False),
        )
        _ <- assertSessionExists(fixture.subject, expected = false)
        _ <- List(read(uri"/api/auth/me", fixture.subject), recalculate).traverse_ { request =>
          fixture.app.run(request).flatMap(response =>
            assertProblem(response, Status.Unauthorized, "UNAUTHORIZED", "Authentication")
          )
        }
        afterDisabling <- savedActivity
      yield assertEquals(afterDisabling, accepted)
    }

  test("self-demotion keeps the same session operational and immediately removes administrator access"):
    withSessionApp(AccountRole.Admin) { fixture =>
      val demote = mutation(
        Method.PATCH,
        accountUri,
        fixture.subject,
        "self-demotion",
        Json.obj("role" -> Json.fromString("operator")),
      )
      for
        _ <- assertCurrentRole(fixture, AccountRole.Admin)
        changed <- successfulJson(fixture, demote, Status.Ok)
        _ = assertEquals(jsonField[String](changed, "role"), "operator")
        _ <- assertCurrentRole(fixture, AccountRole.Operator)
        _ <- assertSessionExists(fixture.subject, expected = true)
        _ <- forbidden(fixture, demote)
        _ <- forbidden(
          fixture,
          mutation(
            Method.PATCH,
            accountUri,
            fixture.subject,
            "denied-self-promotion",
            Json.obj("role" -> Json.fromString("admin")),
          ),
        )
        _ <- forbidden(fixture, read(uri"/api/admin/login-accounts", fixture.subject))
        _ <- successfulJson(
          fixture,
          mutation(Method.POST, uri"/api/map-masters", fixture.subject, "operator-map", mapBody),
          Status.Ok,
        )
        current <- successfulJson(fixture, read(uri"/api/auth/me", fixture.subject), Status.Ok)
        saved <- savedActivity
      yield
        assertEquals(current.hcursor.get[String]("role"), Right("operator"))
        assertEquals(saved.maps, List(("map_role_session", "Session role map")))
        assertEquals(saved.idempotencyKeys, 2)
    }

  private def withSessionApp(role: AccountRole)(test: SessionApp => IO[Unit]): IO[Unit] =
    tempDirectory("momo-api-postgres-session").flatMap { directory =>
      ApiApp.wiredWithHandles[IO](AppConfig(
        appEnv = AppEnv.Prod,
        httpHost = "127.0.0.1",
        httpPort = 0,
        imageTmpDir = directory,
        devMemberIds = List("member_ponta", "member_akane_mami", "member_otaka", "member_eu"),
        auth = authConfig,
        database = Some(dbFixture().databaseConfig),
      )).evalMap { wired =>
        for
          now <- IO.realTimeInstant
          account <- wired.handles.loginAccounts.create(CreateLoginAccountData(
            id = subjectId,
            discordUserId = UserId.unsafeFromString("623456789012345678"),
            displayName = "Session subject",
            playerMemberId = None,
            loginEnabled = true,
            role = role,
            createdAt = now,
            updatedAt = now,
          )).map(_.fold(error => fail(s"could not create account fixture: $error"), identity))
          administrator <- wired.handles.loginAccounts.find(
            AccountId.unsafeFromString("account_ponta")
          ).map(_.getOrElse(fail("seed administrator is missing")))
          _ = assertEquals(administrator.role, AccountRole.Admin)
          _ <- wired.handles.gameTitles.createWithNextDisplayOrder(GameTitle(
            titleId,
            "Session roles",
            "momotetsu2",
            1,
            now,
          )).map(_.fold(error => fail(s"could not create title fixture: $error"), identity))
          administratorSession <- credentials(wired, administrator)
          subjectSession <- credentials(wired, account)
        yield SessionApp(
          wired.runtime.app,
          wired.runtime.backgroundFailure,
          administratorSession,
          subjectSession,
        )
      }
    }.use(fixture => test(fixture).race(fixture.backgroundFailure).void)
      .guarantee(dbFixture().cleanup() *> sql"""
        DELETE FROM momo_login_accounts WHERE id = $subjectId
      """.update.run.transact(transactor).void)

  private def credentials(
      wired: ApiApp.WiredRuntime[IO],
      account: LoginAccount,
  ): IO[Credentials] =
    for
      created <- wired.handles.createSession(account)
      tokens <- IO.fromOption(SessionCookieCodec.decode(created.cookieValue))(
        new IllegalStateException("created session cookie could not be decoded")
      )
      idHash <- SessionTokenHash.sha256[IO](tokens.sessionToken)
    yield Credentials(created.cookieValue, tokens.csrfToken, idHash)

  private def read(uri: Uri, credentials: Credentials): Request[IO] =
    Request[IO](Method.GET, uri).putHeaders(
      Header.Raw(CIString("Cookie"), s"${authConfig.sessionCookieName}=${credentials.cookie}")
    )

  private def mutation(
      method: Method,
      uri: Uri,
      credentials: Credentials,
      idempotencyKey: String,
      body: Json,
  ): Request[IO] = read(uri, credentials).withMethod(method).putHeaders(
    Header.Raw(CIString("X-CSRF-Token"), credentials.csrfToken),
    Header.Raw(CIString("Idempotency-Key"), idempotencyKey),
  ).withEntity(body)

  private def successfulJson(
      fixture: SessionApp,
      request: Request[IO],
      status: Status,
  ): IO[Json] = fixture.app.run(request).flatMap { response =>
    response.as[Json].map { body =>
      assertEquals(response.status, status)
      body
    }
  }

  private def forbidden(fixture: SessionApp, request: Request[IO]): IO[Unit] =
    fixture.app.run(request).flatMap(response =>
      assertProblem(response, Status.Forbidden, "FORBIDDEN", "access is required")
    )

  private def updateAccount(
      fixture: SessionApp,
      credentials: Credentials,
      idempotencyKey: String,
      body: Json,
  ): IO[Unit] = successfulJson(
    fixture,
    mutation(Method.PATCH, accountUri, credentials, idempotencyKey, body),
    Status.Ok,
  ).void

  private def assertCurrentRole(fixture: SessionApp, role: AccountRole): IO[Unit] =
    successfulJson(fixture, read(uri"/api/auth/me", fixture.subject), Status.Ok).map { body =>
      assertEquals(body.hcursor.get[String]("accountId"), Right(subjectId.value))
      assertEquals(body.hcursor.get[Option[String]]("memberId"), Right(None))
      assertEquals(body.hcursor.get[String]("role"), Right(role.wire))
    }

  private def assertSessionExists(credentials: Credentials, expected: Boolean): IO[Unit] =
    new PostgresAppSessionsRepository[IO](transactor).find(credentials.idHash)
      .map(session => assertEquals(session.nonEmpty, expected))

  private def savedActivity: IO[SavedActivity] =
    (for
      maps <- sql"""
        SELECT id, name FROM map_masters WHERE game_title_id = $titleId ORDER BY id
      """.query[(String, String)].to[List]
      analysisRequests <- sql"""
        SELECT id, status FROM series_analysis_operation_requests
        WHERE requested_by_account_id = $subjectId ORDER BY id
      """.query[(String, String)].to[List]
      analysisJobs <- sql"""
        SELECT id, status FROM series_analysis_jobs WHERE game_title_id = $titleId ORDER BY id
      """.query[(String, String)].to[List]
      analysisJobRequests <- sql"""
        SELECT operation_request_id, assigned_job_id, status FROM series_analysis_job_requests
        WHERE game_title_id = $titleId ORDER BY id
      """.query[(String, Option[String], String)].to[List]
      candidates <- sql"""
        SELECT id, status FROM series_radar_candidates WHERE game_title_id = $titleId ORDER BY id
      """.query[(String, String)].to[List]
      radarOperations <- sql"""
        SELECT id, status, candidate_id FROM series_radar_operations
        WHERE requested_by = $subjectId ORDER BY id
      """.query[(String, String, Option[String])].to[List]
      idempotencyKeys <- sql"""
        SELECT COUNT(*)::int FROM idempotency_keys WHERE account_id = $subjectId
      """.query[Int].unique
    yield SavedActivity(
      maps,
      analysisRequests,
      analysisJobs,
      analysisJobRequests,
      candidates,
      radarOperations,
      idempotencyKeys,
    )).transact(transactor)
end PostgresSessionAuthorizationSpec
