package momo.api.endpoints

import sttp.tapir.*
import sttp.tapir.generic.auto.*
import sttp.tapir.json.circe.*

import momo.api.endpoints.AchievementApiSchemas.given

object AchievementsEndpoints:
  val catalog: CommonEndpoint.SecuredRead[String, AchievementCatalogResponse] = endpoint
    .get
    .in("api" / "achievements" / "catalog")
    .securityIn(CommonEndpoint.accountHeader)
    .in(query[String]("gameTitleId"))
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[AchievementCatalogResponse])
    .out(header("Cache-Control", "private, no-store"))
    .tag("achievements")

  val reorder: CommonEndpoint.SecuredMutation[
    (Option[String], ReorderAchievementsRequest),
    AchievementCatalogResponse
  ] = endpoint
    .put
    .in("api" / "achievements" / "catalog" / "order")
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .in(CommonEndpoint.idempotencyKeyHeader)
    .in(jsonBody[ReorderAchievementsRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[AchievementCatalogResponse])
    .tag("achievements")

  val create: CommonEndpoint.SecuredMutation[
    (Option[String], CreateAchievementRequest),
    AchievementItemResponse
  ] = endpoint
    .post
    .in("api" / "achievements" / "items")
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .in(CommonEndpoint.idempotencyKeyHeader)
    .in(jsonBody[CreateAchievementRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[AchievementItemResponse])
    .tag("achievements")

  val update: CommonEndpoint.SecuredMutation[
    (String, Option[String], UpdateAchievementRequest),
    AchievementItemResponse
  ] = endpoint
    .put
    .in("api" / "achievements" / "items" / path[String]("achievementId"))
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .in(CommonEndpoint.idempotencyKeyHeader)
    .in(jsonBody[UpdateAchievementRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[AchievementItemResponse])
    .tag("achievements")

  val retire: CommonEndpoint.SecuredMutation[
    (String, Option[String], RetireAchievementRequest),
    AchievementItemResponse
  ] = endpoint
    .post
    .in("api" / "achievements" / "items" / path[String]("achievementId") / "retire")
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .in(CommonEndpoint.idempotencyKeyHeader)
    .in(jsonBody[RetireAchievementRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[AchievementItemResponse])
    .tag("achievements")

  val correctClaim: CommonEndpoint.SecuredMutation[
    (String, Option[String], CorrectAchievementClaimRequest),
    AchievementClaimResponse
  ] = endpoint
    .put
    .in("api" / "achievements" / "claims" / path[String]("claimId"))
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .in(CommonEndpoint.idempotencyKeyHeader)
    .in(jsonBody[CorrectAchievementClaimRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[AchievementClaimResponse])
    .tag("achievements")

  val addToMatch: CommonEndpoint.SecuredMutation[
    (String, Option[String], AddMatchAchievementsRequest),
    AchievementSavedResponse
  ] = endpoint
    .post
    .in("api" / "matches" / path[String]("matchId") / "achievements")
    .securityIn(CommonEndpoint.accountHeader.and(CommonEndpoint.csrfHeader))
    .in(CommonEndpoint.idempotencyKeyHeader)
    .in(jsonBody[AddMatchAchievementsRequest])
    .errorOut(CommonEndpoint.errorOut)
    .out(jsonBody[AchievementSavedResponse])
    .tag("achievements")
