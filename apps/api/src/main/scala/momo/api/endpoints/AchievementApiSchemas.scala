package momo.api.endpoints

import sttp.tapir.Schema
import sttp.tapir.generic.auto.*

object AchievementApiSchemas:
  private def nullable[A](schema: Schema[Option[A]]): Schema[Option[A]] =
    schema.modifyUnsafe[A](Schema.ModifyCollectionElements)(value =>
      value.copy(name = None).nullable
    )
  private def requiredNullable[A](schema: Schema[Option[A]]): Schema[Option[A]] =
    nullable(schema).copy(isOptional = false)

  given Schema[AchievementItemResponse] = Schema.derived[AchievementItemResponse]
    .modify(_.threshold)(requiredNullable)
    .modify(_.appliesFrom)(requiredNullable)
    .modify(_.retiredAt)(requiredNullable)
  given Schema[AchievementClaimResponse] = Schema.derived[AchievementClaimResponse]
    .modify(_.matchId)(requiredNullable)
    .modify(_.achievedAt)(requiredNullable)
  given Schema[AchievementCatalogResponse] = Schema.derived
  given Schema[ReorderAchievementsRequest] = Schema.derived[ReorderAchievementsRequest]
    .modify(_.achievementIds)(_.copy(isOptional = false))
  given Schema[CreateAchievementRequest] = Schema.derived[CreateAchievementRequest]
    .modify(_.threshold)(nullable)
  given Schema[AddMatchAchievementRequest] = Schema.derived[AddMatchAchievementRequest]
    .modify(_.expectedClaimVersion)(nullable)
  given Schema[AddMatchAchievementsRequest] = Schema.derived
  given Schema[CorrectAchievementClaimRequest] = Schema.derived[CorrectAchievementClaimRequest]
    .modify(_.matchId)(nullable)
    .modify(_.achievedAt)(nullable)
    .modify(_.expectedMatchVersion)(nullable)
  given Schema[ConfirmMatchRequest] = Schema.derived
  given Schema[UpdateMatchRequest] = Schema.derived[UpdateMatchRequest]
    .modify(_.expectedVersion)(_.copy(isOptional = false, default = None))
