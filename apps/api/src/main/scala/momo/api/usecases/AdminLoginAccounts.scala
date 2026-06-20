package momo.api.usecases

import java.time.Instant

import cats.MonadThrow
import cats.data.EitherT
import cats.syntax.all.*

import momo.api.domain.LoginAccount
import momo.api.domain.ids.{AccountId, MemberId, UserId}
import momo.api.errors.AppError
import momo.api.repositories.{
  CreateLoginAccountData, LoginAccountAdministrationRepository,
  LoginAccountAdministrationUpdateResult, LoginAccountsRepository, MembersRepository,
  UpdateLoginAccountData,
}
import momo.api.usecases.syntax.UseCaseSyntax.*

final case class CreateLoginAccountCommand(
    discordUserId: UserId,
    displayName: String,
    playerMemberId: Option[MemberId],
    loginEnabled: Boolean,
    isAdmin: Boolean,
)

final case class UpdateLoginAccountCommand(
    displayName: Option[String],
    playerMemberId: Option[Option[MemberId]],
    loginEnabled: Option[Boolean],
    isAdmin: Option[Boolean],
)

final class ListLoginAccounts[F[_]](accounts: LoginAccountsRepository[F]):
  def run: F[List[LoginAccount]] = accounts.list

final class CreateLoginAccount[F[_]: MonadThrow](
    accounts: LoginAccountsRepository[F],
    members: MembersRepository[F],
    now: F[Instant],
    nextId: F[AccountId],
):
  def run(command: CreateLoginAccountCommand): F[Either[AppError, LoginAccount]] = (for
    discordUserId <- EitherT.fromEither[F](LoginAccountField.discordUserId(command.discordUserId))
    displayName <- EitherT.fromEither[F](LoginAccountField.displayName(command.displayName))
    _ <- command.playerMemberId.traverse(id => members.find(id).orNotFound("member", id.value)).void
    existing <- EitherT.liftF(accounts.findByDiscordUserId(discordUserId))
    _ <- EitherT.fromEither[F](
      Either.cond(existing.isEmpty, (), AppError.Conflict("discordUserId is already registered."))
    )
    id <- EitherT.liftF(nextId)
    at <- EitherT.liftF(now)
    created <- EitherT.liftF(accounts.create(CreateLoginAccountData(
      id = id,
      discordUserId = discordUserId,
      displayName = displayName,
      playerMemberId = command.playerMemberId,
      loginEnabled = command.loginEnabled,
      isAdmin = command.isAdmin,
      createdAt = at,
      updatedAt = at,
    )))
  yield created).value

final class UpdateLoginAccount[F[_]: MonadThrow](
    administration: LoginAccountAdministrationRepository[F],
    members: MembersRepository[F],
    now: F[Instant],
):
  def run(id: AccountId, command: UpdateLoginAccountCommand): F[Either[AppError, LoginAccount]] =
    (for
      displayName <- EitherT
        .fromEither[F](command.displayName.traverse(LoginAccountField.displayName))
      _ <- command.playerMemberId.flatten
        .traverse(mid => members.find(mid).orNotFound("member", mid.value)).void
      at <- EitherT.liftF(now)
      result <- EitherT.liftF(administration.updateAndRevokeSessionsWhenDisabled(
        id,
        UpdateLoginAccountData(
          displayName = displayName,
          playerMemberId = command.playerMemberId,
          loginEnabled = command.loginEnabled,
          isAdmin = command.isAdmin,
          updatedAt = at,
        ),
      ))
      updated <- result match
        case LoginAccountAdministrationUpdateResult.Updated(value) => EitherT
            .rightT[F, AppError](value)
        case LoginAccountAdministrationUpdateResult.LastEnabledAdmin => EitherT
            .leftT[F, LoginAccount](lastAdminConflict)
        case LoginAccountAdministrationUpdateResult.NotFound => EitherT
            .leftT[F, LoginAccount](AppError.NotFound("login account", id.value))
    yield updated).value

  private val lastAdminConflict: AppError = AppError
    .Conflict("At least one enabled administrator account is required.")

private[usecases] object LoginAccountField:
  private val DiscordUserIdPattern = "^[0-9]{5,32}$".r
  private val MaxDisplayNameLength = 64

  def discordUserId(value: UserId): Either[AppError, UserId] = Either.cond(
    DiscordUserIdPattern.pattern.matcher(value.value).matches(),
    value,
    AppError.ValidationFailed("discordUserId must be a Discord snowflake-like numeric id."),
  )

  def displayName(value: String): Either[AppError, String] =
    boundedText(field = "displayName", value = value, maxLength = MaxDisplayNameLength)

  private def boundedText(field: String, value: String, maxLength: Int): Either[AppError, String] =
    val trimmed = value.trim
    Either.cond(
      trimmed.nonEmpty && trimmed.length <= maxLength,
      trimmed,
      AppError.ValidationFailed(s"$field must be 1 to ${maxLength.toString} characters."),
    )
