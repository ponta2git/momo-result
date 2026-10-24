package momo.api.endpoints.codec

import java.time.Instant
import java.util.UUID

import cats.syntax.all.*

import momo.api.domain.*
import momo.api.domain.ids.{GameTitleId, MapMasterId, MatchId, MemberId}
import momo.api.endpoints.*
import momo.api.errors.AppError

object AchievementCodec:
  private def invalid(message: String): AppError = AppError.ValidationFailed(message)

  def id(value: String): Either[AppError, UUID] =
    Either.catchNonFatal(UUID.fromString(value)).leftMap(_ => invalid("achievement ID is invalid."))

  def version(value: String): Either[AppError, Long] = value.toLongOption
    .filter(_ >= 0L).toRight(invalid("expected version must be a non-negative integer."))

  def requiredMatchVersion(value: Option[String]): Either[AppError, Long] = value
    .toRight(invalid("expectedVersion is required. Refresh the match before saving."))
    .flatMap(version)

  private def text(name: String, notes: String, stars: Int): Either[AppError, Unit] =
    Either.cond(
      name.trim.nonEmpty && name.codePointCount(0, name.length) <= 300 &&
        notes.codePointCount(0, notes.length) <= 4000 && stars >= 1 && stars <= 5,
      (),
      invalid("name must be 1..300 characters, notes at most 4000, and stars 1..5."),
    )

  def create(request: CreateAchievementRequest): Either[AppError, CreateAchievement] =
    for
      _ <- text(request.name, request.notes, request.stars)
      title <- BoundaryId.required("gameTitleId", request.gameTitleId)(GameTitleId.fromString)
      maps <- request.mapMasterIds.traverse(value =>
        BoundaryId.required("mapMasterIds", value)(MapMasterId.fromString)
      )
      _ <- Either.cond(
        maps.distinct.size == maps.size && maps.size <= 100 &&
          (if request.common then maps.isEmpty else maps.nonEmpty),
        (),
        invalid("Choose common without maps, or one or more distinct maps."),
      )
      rule <- AchievementRule.fromWire(request.ruleKind).toRight(invalid("Unknown ruleKind."))
      threshold <- request.threshold.traverse(value =>
        Either.catchNonFatal(BigDecimal(value)).leftMap(_ => invalid("threshold must be numeric."))
      )
      validThreshold = rule match
        case AchievementRule.Manual => threshold.isEmpty
        case AchievementRule.EventAverageRank => threshold.exists(v => v >= 1 && v <= 4)
        case _ => threshold.exists(v => v > 0 && v.isWhole && v <= Int.MaxValue)
      _ <- Either.cond(validThreshold, (), invalid("threshold is invalid for ruleKind."))
    yield CreateAchievement(
      title,
      request.name.trim,
      request.notes,
      request.common,
      maps,
      rule,
      threshold,
      request.stars
    )

  def update(request: UpdateAchievementRequest): Either[AppError, UpdateAchievement] =
    for
      _ <- text(request.name, request.notes, request.stars)
      expected <- version(request.expectedVersion)
    yield UpdateAchievement(request.name.trim, request.notes, request.stars, expected)

  def additions(values: List[AddMatchAchievementRequest])
      : Either[AppError, List[AddMatchAchievement]] =
    for
      parsed <- values.traverse(value =>
        (
          id(value.achievementId),
          BoundaryId.required("memberId", value.memberId)(MemberId.fromString),
          version(value.expectedItemVersion),
          value.expectedClaimVersion.traverse(version),
        ).mapN(AddMatchAchievement.apply)
      )
      _ <- Either.cond(
        parsed.size <= 400 &&
          parsed.map(v => v.achievementId -> v.memberId).distinct.size == parsed.size,
        (),
        invalid("Duplicate or excessive achievement declarations."),
      )
    yield parsed

  def addToMatch(request: AddMatchAchievementsRequest): Either[AppError, AddMatchAchievements] =
    (version(request.expectedMatchVersion), additions(request.achievements))
      .mapN(AddMatchAchievements.apply)

  def correct(request: CorrectAchievementClaimRequest): Either[AppError, CorrectAchievementClaim] =
    for
      expected <- version(request.expectedVersion)
      item <- version(request.expectedItemVersion)
      _ <- Either.cond(
        Set("achieved", "cancelled").contains(request.state),
        (),
        invalid("state must be achieved or cancelled.")
      )
      matched <- BoundaryId.optional("matchId", request.matchId)(MatchId.fromString)
      achieved <- request.achievedAt.traverse(value =>
        Either.catchNonFatal(Instant.parse(value)).leftMap(_ =>
          invalid("achievedAt must be an ISO8601 instant.")
        )
      )
      matchVersion <- request.expectedMatchVersion.traverse(version)
      _ <- Either.cond(
        matched.isDefined == matchVersion.isDefined,
        (),
        invalid("A linked match requires its expected version.")
      )
    yield CorrectAchievementClaim(expected, item, request.state, matched, achieved, matchVersion)
