package momo.api.http

import java.time.Instant

import cats.syntax.all.*
import io.circe.Json
import org.http4s.circe.*
import org.http4s.implicits.*
import org.http4s.{Method, Status, Uri}

import momo.api.domain.ids.{AccountId, GameTitleId, UserId}
import momo.api.domain.{AccountRole, GameTitle}
import momo.api.http.HttpAssertions.{assertProblem, jsonField}
import momo.api.integration.PostgresHttpAppTestFixtures
import momo.api.repositories.CreateLoginAccountData

final class RoleAuthorizationHttpSpec extends PostgresHttpAppTestFixtures:
  private val operator = "account_operator"
  private val otherOperator = "account_other_operator"
  private val managingAdmin = "account_managing_admin"
  private val user = "account_akane_mami"
  private val title = "title_role_authorization"
  private val overviewUri = uri"/api/admin/series-analysis/overview"
  private val titleRecalculationUri = uri"/api/admin/series-analysis/recalculations"
  private val allRecalculationUri = uri"/api/admin/series-analysis/recalculations/all"
  private val operationsUri = uri"/api/admin/series-analysis/radar/operations"
  private val radarStateUri = Uri.unsafeFromString(
    s"/api/admin/series-analysis/radar?gameTitleId=$title"
  )
  private val titleBody = Json.obj("gameTitleId" -> Json.fromString(title))
  private val allBody = Json.obj("confirmation" -> Json.fromString("all_titles"))
  private val candidateBody = titleBody.mapObject(_.add("kind", Json.fromString("candidate")))

  private val app = ResourceFunFixture(seededWiredHttpAppResource(
    "momo-api-role-authorization",
    runtime =>
      val now = Instant.parse("2026-10-12T00:00:00Z")
      List(
        (operator, "123456789012345671", AccountRole.Operator),
        (otherOperator, "123456789012345672", AccountRole.Operator),
        (managingAdmin, "123456789012345673", AccountRole.Admin),
      ).traverse_ { case (id, discordId, role) =>
        runtime.loginAccounts.create(CreateLoginAccountData(
          AccountId.unsafeFromString(id),
          UserId.unsafeFromString(discordId),
          id,
          None,
          true,
          role,
          now,
          now,
        )).map(result => assert(result.isRight))
      } *> runtime.gameTitles.createWithNextDisplayOrder(GameTitle(
        GameTitleId.unsafeFromString(title),
        "Role authorization",
        "momotetsu2",
        1,
        now,
      )).void,
  ))

  app.test("operators can maintain map and season masters while users cannot mutate them") { http =>
    List("map-masters", "season-masters").traverse_ { resource =>
      val id = if resource == "map-masters" then "map_role" else "season_role"
      val collection = Uri.unsafeFromString(s"/api/$resource")
      val item = Uri.unsafeFromString(s"/api/$resource/$id")
      val create = Json.obj(
        "id" -> Json.fromString(id),
        "gameTitleId" -> Json.fromString(title),
        "name" -> Json.fromString("Original"),
      )
      val update = Json.obj("name" -> Json.fromString("Updated"))
      for
        deniedCreate <- http.run(writePost(collection, create, user))
        _ <- assertProblem(deniedCreate, Status.Forbidden, "FORBIDDEN", "Operator access")
        created <- http.run(writePost(collection, create, operator))
        _ = assertEquals(created.status, Status.Ok)
        deniedUpdate <- http.run(writePatch(item, update, user))
        _ <- assertProblem(deniedUpdate, Status.Forbidden, "FORBIDDEN", "Operator access")
        updated <- http.run(writePatch(item, update, operator))
        updatedBody <- updated.as[Json]
        deniedDelete <- http.run(writeDelete(item, user))
        _ <- assertProblem(deniedDelete, Status.Forbidden, "FORBIDDEN", "Operator access")
        listed <- http.run(readGet(collection, user)).flatMap(_.as[Json])
        deleted <- http.run(writeDelete(item, operator))
        after <- http.run(readGet(collection, user)).flatMap(_.as[Json])
      yield
        assertEquals(updated.status, Status.Ok)
        assertEquals(jsonField[String](updatedBody, "name"), "Updated")
        assertEquals(jsonField[List[Json]](listed, "items").size, 1)
        assertEquals(deleted.status, Status.Ok)
        assertEquals(jsonField[List[Json]](after, "items"), Nil)
    }
  }

  app.test(
    "operators cannot mutate titles, aliases, accounts, global notifications, or all titles"
  ) { http =>
    val titleForm = Json.obj(
      "id" -> Json.fromString("title_denied"),
      "name" -> Json.fromString("Denied"),
      "layoutFamily" -> Json.fromString("momotetsu2"),
    )
    val aliasForm = Json.obj(
      "memberId" -> Json.fromString("member_ponta"),
      "alias" -> Json.fromString("Denied"),
    )
    val accountForm = Json.obj(
      "discordUserId" -> Json.fromString("123456789012345674"),
      "displayName" -> Json.fromString("Denied"),
      "loginEnabled" -> Json.True,
      "role" -> Json.fromString("admin"),
    )
    val notification = Json.obj(
      "enabled" -> Json.False,
      "expectedGeneration" -> Json.fromString("0"),
    )
    val requests = List(
      writePost(uri"/api/game-titles", titleForm, operator),
      writePatch(Uri.unsafeFromString(s"/api/game-titles/$title"), titleForm, operator),
      writeDelete(Uri.unsafeFromString(s"/api/game-titles/$title"), operator),
      writePost(uri"/api/member-aliases", aliasForm, operator),
      writePatch(uri"/api/member-aliases/alias_denied", aliasForm, operator),
      writeDelete(uri"/api/member-aliases/alias_denied", operator),
      readGet(uri"/api/admin/login-accounts", operator),
      writePost(uri"/api/admin/login-accounts", accountForm, operator),
      writePatch(
        uri"/api/admin/login-accounts/account_ponta",
        Json.obj("role" -> Json.fromString("user")),
        operator
      ),
      readGet(uri"/api/admin/notification-settings", operator),
      writeRequest(Method.PUT, uri"/api/admin/notification-settings", operator).withEntity(Json.obj(
        "ocrCompleted" -> notification,
        "analysisCompleted" -> notification,
      )),
      writePost(allRecalculationUri, allBody, operator, Some("operator-all-denied")),
    )
    requests.traverse_ { request =>
      http.run(request).flatMap(response =>
        assertProblem(response, Status.Forbidden, "FORBIDDEN", "Administrator access")
      )
    }
  }

  app.test("operators can inspect analysis and request one title; users cannot") { http =>
    val previewUri = Uri.unsafeFromString(
      s"/api/admin/series-analysis/radar/preview?gameTitleId=$title&previewId=missing-preview"
    )
    val operationUri = Uri.unsafeFromString(
      s"/api/admin/series-analysis/radar/operation?gameTitleId=$title&operationId=missing-operation"
    )
    for
      _ <- List(overviewUri, radarStateUri, previewUri, operationUri).traverse_ { uri =>
        http.run(readGet(uri, user)).flatMap(response =>
          assertProblem(response, Status.Forbidden, "FORBIDDEN", "Operator access")
        )
      }
      overview <- http.run(readGet(overviewUri, operator))
      overviewBody <- overview.as[Json]
      state <- http.run(readGet(radarStateUri, operator))
      stateBody <- state.as[Json]
      preview <- http.run(readGet(previewUri, operator))
      _ <- assertProblem(preview, Status.NotFound, "NOT_FOUND", "radar preview")
      operation <- http.run(readGet(operationUri, operator))
      _ <- assertProblem(operation, Status.NotFound, "NOT_FOUND", "radar operation")
      denied <-
        http.run(writePost(titleRecalculationUri, titleBody, user, Some("user-title-denied")))
      _ <- assertProblem(denied, Status.Forbidden, "FORBIDDEN", "Operator access")
      noCsrf <-
        http.run(readRequest(Method.POST, titleRecalculationUri, operator).withEntity(titleBody))
      _ <- assertProblem(noCsrf, Status.Forbidden, "FORBIDDEN", "CSRF")
      accepted <-
        http.run(writePost(titleRecalculationUri, titleBody, operator, Some("operator-title")))
      body <- accepted.as[Json]
    yield
      assertEquals(overview.status, Status.Ok)
      assertEquals(
        overviewBody.hcursor.downField("titleOptions").downArray.get[String]("gameTitleId"),
        Right(title),
      )
      assertEquals(state.status, Status.Ok)
      assertEquals(jsonField[String](stateBody, "gameTitleId"), title)
      assertEquals(accepted.status, Status.Accepted)
      assertEquals(jsonField[Int](body, "targetCount"), 1)
      assertEquals(body.hcursor.downField("target").get[String]("gameTitleId"), Right(title))
  }

  app.test("operators may handle another operator's saved radar candidate") { http =>
    for
      accepted <-
        http.run(writePost(operationsUri, candidateBody, operator, Some("operator-candidate")))
      first <- accepted.as[Json]
      candidate = jsonField[String](first, "candidateId")
      operation = jsonField[String](first, "operationId")
      observed <- http.run(readGet(
        Uri.unsafeFromString(
          s"/api/admin/series-analysis/radar/operation?gameTitleId=$title&operationId=$operation"
        ),
        otherOperator
      )).flatMap(_.as[Json])
      withdrawn <- http.run(writePost(
        operationsUri,
        candidateBody.mapObject(
          _.add("kind", Json.fromString("withdraw")).add("candidateId", Json.fromString(candidate))
        ),
        otherOperator,
        Some("other-operator-withdraw")
      ))
      state <- http.run(readGet(radarStateUri, otherOperator)).flatMap(_.as[Json])
    yield
      assertEquals(accepted.status, Status.Accepted)
      assertEquals(observed, first)
      assertEquals(withdrawn.status, Status.Accepted)
      assertEquals(state.hcursor.downField("candidate").get[String]("status"), Right("withdrawn"))
  }

  app.test(
    "demotion rejects saved and new mutation keys while retaining accepted analysis and radar state"
  ) { http =>
    for
      all <- http.run(writePost(allRecalculationUri, allBody, managingAdmin, Some("saved-all")))
      _ = assertEquals(all.status, Status.Accepted)
      titleResult <-
        http.run(writePost(titleRecalculationUri, titleBody, operator, Some("saved-title")))
      _ = assertEquals(titleResult.status, Status.Accepted)
      radar <- http.run(writePost(operationsUri, candidateBody, operator, Some("saved-radar")))
      _ = assertEquals(radar.status, Status.Accepted)
      overviewBefore <- http.run(readGet(overviewUri)).flatMap(_.as[Json])
      radarBefore <- http.run(readGet(radarStateUri)).flatMap(_.as[Json])
      _ <- List(managingAdmin -> "operator", operator -> "user").traverse_ { case (account, role) =>
        http.run(writePatch(
          Uri.unsafeFromString(s"/api/admin/login-accounts/$account"),
          Json.obj("role" -> Json.fromString(role))
        )).map(response => assertEquals(response.status, Status.Ok))
      }
      _ <- List("saved-all", "new-all").traverse_ { key =>
        http.run(writePost(allRecalculationUri, allBody, managingAdmin, Some(key))).flatMap(
          response =>
            assertProblem(response, Status.Forbidden, "FORBIDDEN", "Administrator access")
        )
      }
      _ <- List(
        (titleRecalculationUri, titleBody, "saved-title"),
        (titleRecalculationUri, titleBody, "new-title"),
        (operationsUri, candidateBody, "saved-radar"),
        (operationsUri, candidateBody, "new-radar"),
      ).traverse_ { case (uri, body, key) =>
        http.run(writePost(uri, body, operator, Some(key))).flatMap(response =>
          assertProblem(response, Status.Forbidden, "FORBIDDEN", "Operator access")
        )
      }
      overviewAfter <- http.run(readGet(overviewUri)).flatMap(_.as[Json])
      radarAfter <- http.run(readGet(radarStateUri)).flatMap(_.as[Json])
    yield
      assertEquals(overviewAfter, overviewBefore)
      assertEquals(radarAfter, radarBefore)
  }
