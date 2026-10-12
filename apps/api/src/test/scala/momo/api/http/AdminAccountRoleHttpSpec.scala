package momo.api.http

import cats.syntax.all.*
import io.circe.Json
import io.circe.syntax.*
import org.http4s.circe.*
import org.http4s.implicits.*
import org.http4s.{Status, Uri}

import momo.api.MomoCatsEffectSuite
import momo.api.domain.AccountRole
import momo.api.endpoints.UpdateLoginAccountRequest
import momo.api.http.HttpAssertions.jsonField

final class AdminAccountRoleHttpSpec extends MomoCatsEffectSuite with HttpAppTestFixtures:
  private val app = ResourceFunFixture(httpAppResource("momo-api-account-roles"))
  private val accountsUri = uri"/api/admin/login-accounts"
  private val targetUri = uri"/api/admin/login-accounts/account_akane_mami"

  private def createBody(role: Json): Json = Json.obj(
    "discordUserId" -> Json.fromString("123456789012345678"),
    "displayName" -> Json.fromString("role-account"),
    "playerMemberId" -> Json.Null,
    "loginEnabled" -> Json.True,
    "role" -> role,
  )

  AccountRole.values.toList.foreach { role =>
    app.test(s"account creation and listing expose the ${role.wire} role without isAdmin") { http =>
      for
        created <- http.run(writePost(accountsUri, createBody(Json.fromString(role.wire))))
        body <- created.as[Json]
        listed <- http.run(readGet(accountsUri)).flatMap(_.as[Json])
      yield
        assertEquals(created.status, Status.Ok)
        assertEquals(jsonField[String](body, "role"), role.wire)
        assert(!body.hcursor.downField("isAdmin").succeeded)
        val items = jsonField[List[Json]](listed, "items")
        val createdId = jsonField[String](body, "accountId")
        assert(items.exists(item => jsonField[String](item, "accountId") == createdId))
        assert(items.forall(!_.hcursor.downField("isAdmin").succeeded))
    }
  }

  app.test("invalid create roles, legacy fields, and unknown fields cannot create an account") {
    http =>
      val valid = createBody(Json.fromString("operator"))
      val invalidRoles = List(
        Json.Null,
        Json.fromString("owner"),
        Json.fromString("Operator"),
        Json.True,
        Json.fromInt(1),
        Json.obj()
      )
      val invalid = invalidRoles.map(role => valid.mapObject(_.add("role", role))) ++ List(
        valid.mapObject(_.remove("role")),
        valid.mapObject(_.remove("role").add("isAdmin", Json.False)),
        valid.mapObject(_.add("isAdmin", Json.False)),
        valid.mapObject(_.add("unexpected", Json.True)),
      )
      for
        before <- http.run(readGet(accountsUri)).flatMap(_.as[Json])
        statuses <- invalid.traverse(body => http.run(writePost(accountsUri, body)).map(_.status))
        after <- http.run(readGet(accountsUri)).flatMap(_.as[Json])
      yield
        assertEquals(statuses, List.fill(invalid.size)(Status.BadRequest))
        assertEquals(after, before)
  }

  app.test("invalid patch fields reject the whole update without changing display name or role") {
    http =>
      val invalidRoles = List(
        Json.Null,
        Json.fromString("owner"),
        Json.fromString("ADMIN"),
        Json.False,
        Json.fromInt(1),
        Json.arr()
      )
      val invalid = invalidRoles.map(role =>
        Json.obj(
          "displayName" -> Json.fromString("must-not-change"),
          "role" -> role,
        )
      ) ++ List(
        Json.obj("isAdmin" -> Json.True),
        Json.obj("displayName" -> Json.fromString("must-not-change"), "isAdmin" -> Json.True),
        Json.obj("role" -> Json.fromString("admin"), "isAdmin" -> Json.True),
        Json.obj("displayName" -> Json.fromString("must-not-change"), "unexpected" -> Json.True),
      )
      for
        before <- http.run(readGet(accountsUri)).flatMap(_.as[Json])
        statuses <- invalid.traverse(body => http.run(writePatch(targetUri, body)).map(_.status))
        after <- http.run(readGet(accountsUri)).flatMap(_.as[Json])
      yield
        assertEquals(statuses, List.fill(invalid.size)(Status.BadRequest))
        assertEquals(after, before)
  }

  app.test("patch role omission retains the existing role and explicit roles change it") { http =>
    for
      created <- http.run(writePost(accountsUri, createBody(Json.fromString("operator"))))
        .flatMap(_.as[Json])
      accountId = jsonField[String](created, "accountId")
      uri = Uri.unsafeFromString(s"/api/admin/login-accounts/$accountId")
      renamed <- http.run(writePatch(uri, Json.obj("displayName" -> Json.fromString("renamed"))))
        .flatMap(_.as[Json])
      updated <- AccountRole.values.toList.traverse { role =>
        http.run(writePatch(uri, Json.obj("role" -> Json.fromString(role.wire))))
          .flatMap(_.as[Json]).map(json => jsonField[String](json, "role"))
      }
    yield
      assertEquals(jsonField[String](renamed, "role"), "operator")
      assertEquals(jsonField[String](renamed, "displayName"), "renamed")
      assertEquals(updated, AccountRole.values.toList.map(_.wire))
  }

  test("an absent patch role stays absent in idempotency encoding without dropping other nulls") {
    val encoded = UpdateLoginAccountRequest(
      displayName = Some("renamed"),
      playerMemberId = Some(None),
    ).asJson
    assert(!encoded.hcursor.downField("role").succeeded)
    assertEquals(encoded.hcursor.downField("playerMemberId").focus, Some(Json.Null))
    assertEquals(encoded.as[UpdateLoginAccountRequest].map(_.role), Right(None))
  }
