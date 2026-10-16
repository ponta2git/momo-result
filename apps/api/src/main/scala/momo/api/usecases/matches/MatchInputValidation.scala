package momo.api.usecases.matches

import cats.Monad
import cats.data.EitherT
import cats.syntax.all.*

import momo.api.domain.ids.MemberId
import momo.api.domain.{GameTitle, MatchPolicy, MatchRecord}
import momo.api.errors.AppError
import momo.api.usecases.common.MatchReferenceValidation

private[matches] final class MatchInputValidation[F[_]: Monad](
    references: MatchReferenceValidation[F]
):
  def validate(
      input: MatchPolicy.Input,
      allowedMemberIds: Set[MemberId],
  ): EitherT[F, AppError, (MatchRecord.ValidatedInput, GameTitle)] =
    for
      validated <- EitherT.fromEither[F](
        MatchPolicy.validate(input, allowedMemberIds)
          .leftMap(errors => AppError.ValidationFailed(MatchPolicy.toMessage(errors)))
      )
      title <- references.validateRequired(
        validated.heldEventId,
        validated.gameTitleId,
        validated.mapMasterId,
        validated.seasonMasterId,
      )
    yield (validated, title)
