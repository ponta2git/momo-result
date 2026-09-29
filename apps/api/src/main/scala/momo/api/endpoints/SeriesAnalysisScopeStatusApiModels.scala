package momo.api.endpoints

import io.circe.Codec
import sttp.tapir.{Schema, Validator}

import momo.api.domain.SeriesAnalysisScopeStatus

final case class SeriesAnalysisScopeStatusResponse(
    schemaVersion: Int,
    gameTitleId: String,
    artifactId: Option[String],
    seasonMasterId: Option[String],
    mapMasterId: Option[String],
    seasonName: Option[String],
    mapName: Option[String],
    state: String,
    invalidFields: List[String],
    currentHasMatches: Boolean,
    publishedHasMatches: Option[Boolean],
) derives Codec.AsObject

object SeriesAnalysisScopeStatusResponse:
  def from(value: SeriesAnalysisScopeStatus): SeriesAnalysisScopeStatusResponse =
    SeriesAnalysisScopeStatusResponse(1, value.gameTitleId.value, value.artifactId,
      value.scope.seasonMasterId.map(_.value), value.scope.mapMasterId.map(_.value),
      value.seasonName, value.mapName, value.state, value.invalidFields,
      value.currentHasMatches, value.publishedHasMatches)

  private def requiredNullable[A](schema: Schema[Option[A]]): Schema[Option[A]] =
    schema.copy(isOptional = false).modifyUnsafe[A](Schema.ModifyCollectionElements)(nested =>
      nested.copy(name = None).nullable)

  given Schema[SeriesAnalysisScopeStatusResponse] = Schema.derived[SeriesAnalysisScopeStatusResponse]
    .modify(_.schemaVersion)(_.validate(Validator.enumeration(List(1), value => Some(value))))
    .modify(_.artifactId)(requiredNullable)
    .modify(_.seasonMasterId)(requiredNullable)
    .modify(_.mapMasterId)(requiredNullable)
    .modify(_.seasonName)(requiredNullable)
    .modify(_.mapName)(requiredNullable)
    .modify(_.publishedHasMatches)(requiredNullable)
    .modify(_.invalidFields)(_.copy(isOptional = false))
    .modify(_.state)(_.validate(Validator.enumeration(
      List("available", "empty", "awaiting_analysis", "invalid"), value => Some(value))))
