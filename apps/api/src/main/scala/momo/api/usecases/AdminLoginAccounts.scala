package momo.api.usecases

import java.time.Instant

import cats.MonadThrow
import cats.data.EitherT
import cats.syntax.all.*

import momo.api.domain.LoginAccount
import momo.api.domain.ids.{AccountId, MemberId, UserId}
import momo.api.errors.AppError
import momo.api.repositories.{
  AppSessionsRepository, CreateLoginAccountData, LoginAccountsRepository, MembersRepository,
  UpdateLoginAccountData,
}
import momo.api.usecases.syntax.UseCaseSyntax.*

final case class CreateLoginAccountCommand(
    discordUserId: String,
    displayName: String,
    playerMemberId: Option[String],
    loginEnabled: Boolean,
    isAdmin: Boolean,
)

final case class UpdateLoginAccountCommand(
    displayName: Option[String],
    playerMemberId: Option[Option[String]],
    loginEnabled: Option[Boolean],
    isAdmin: Option[Boolean],
)

final class ListLoginAccounts[F[_]](accounts: LoginAccountsRepository[F]):
  def run: F[List[LoginAccount]] = accounts.list

final class CreateLoginAccount[F[_]: MonadThrow](
    accounts: LoginAccountsRepository[F],
    members: MembersRepository[F],
    now: F[Instant],
    nextId: F[String],
):
  def run(command: CreateLoginAccountCommand): F[Either[AppError, LoginAccount]] = (for
    discordUserId <- EitherT.fromEither[F](validateDiscordUserId(command.discordUserId))
    displayName <- EitherT.fromEither[F](validateDisplayName(command.displayName))
    playerMemberId <- EitherT.fromEither[F](command.playerMemberId.traverse(validateMemberId))
    _ <- playerMemberId.traverse(id => members.find(id).orNotFound("member", id.value)).void
    existing <- EitherT.liftF(accounts.findByDiscordUserId(discordUserId))
    _ <- EitherT.fromEither[F](
      Either.cond(existing.isEmpty, (), AppError.Conflict("discordUserId is already registered."))
    )
    id <- EitherT.liftF(nextId.map(AccountId(_)))
    at <- EitherT.liftF(now)
    created <- EitherT.liftF(accounts.create(CreateLoginAccountData(
      id = id,
      discordUserId = discordUserId,
      displayName = displayName,
      playerMemberId = playerMemberId,
      loginEnabled = command.loginEnabled,
      isAdmin = command.isAdmin,
      createdAt = at,
      updatedAt = at,
    )))
  yield created).value

  private def validateDiscordUserId(value: String): Either[AppError, UserId] =
    val trimmed = value.trim
    Either.cond(
      trimmed.matches("^[0-9]{5,32}$"),
      UserId(trimmed),
      AppError.ValidationFailed("discordUserId must be a Discord snowflake-like numeric id."),
    )

  private def validateDisplayName(value: String): Either[AppError, String] =
    val trimmed = value.trim
    Either.cond(
      trimmed.nonEmpty && trimmed.length <= 64,
      trimmed,
      AppError.ValidationFailed("displayName must be 1 to 64 characters."),
    )

  private def validateMemberId(value: String): Either[AppError, MemberId] =
    val trimmed = value.trim
    Either.cond(
      trimmed.nonEmpty,
      MemberId(trimmed),
      AppError.ValidationFailed("playerMemberId must not be blank."),
    )

final class UpdateLoginAccount[F[_]: MonadThrow](
    accounts: LoginAccountsRepository[F],
    members: MembersRepository[F],
    sessions: AppSessionsRepository[F],
    now: F[Instant],
):
  def run(id: AccountId, command: UpdateLoginAccountCommand): F[Either[AppError, LoginAccount]] =
    (for
      existing <- accounts.find(id).orNotFound("login account", id.value)
      displayName <- EitherT.fromEither[F](command.displayName.traverse(validateDisplayName))
      playerMemberId <- EitherT
        .fromEither[F](command.playerMemberId.traverse(_.traverse(validateMemberId)))
      _ <- playerMemberId.flatten.traverse(mid => members.find(mid).orNotFound("member", mid.value))
        .void
      nextLoginEnabled = command.loginEnabled.getOrElse(existing.loginEnabled)
      nextIsAdmin = command.isAdmin.getOrElse(existing.isAdmin)
      _ <- ensureLastAdminIsKept(existing, nextLoginEnabled, nextIsAdmin)
      at <- EitherT.liftF(now)
      updated <- accounts.update(
        id,
        UpdateLoginAccountData(
          displayName = displayName,
          playerMemberId = playerMemberId,
          loginEnabled = command.loginEnabled,
          isAdmin = command.isAdmin,
          updatedAt = at,
        ),
      ).orNotFound("login account", id.value)
      _ <-
        if existing.loginEnabled && !updated.loginEnabled then
          EitherT.liftF(sessions.deleteByAccount(id).void)
        else EitherT.rightT[F, AppError](())
    yield updated).value

  private def ensureLastAdminIsKept(
      existing: LoginAccount,
      nextLoginEnabled: Boolean,
      nextIsAdmin: Boolean,
  ): EitherT[F, AppError, Unit] =
    if existing.loginEnabled && existing.isAdmin && (!nextLoginEnabled || !nextIsAdmin) then
      EitherT(accounts.enabledAdminCount.map { count =>
        Either.cond(
          count > 1,
          (),
          AppError.Conflict("At least one enabled administrator account is required."),
        )
      })
    else EitherT.rightT[F, AppError](())

  private def validateDisplayName(value: String): Either[AppError, String] =
    val trimmed = value.trim
    Either.cond(
      trimmed.nonEmpty && trimmed.length <= 64,
      trimmed,
      AppError.ValidationFailed("displayName must be 1 to 64 characters."),
    )

  private def validateMemberId(value: String): Either[AppError, MemberId] =
    val trimmed = value.trim
    Either.cond(
      trimmed.nonEmpty,
      MemberId(trimmed),
      AppError.ValidationFailed("playerMemberId must not be blank."),
    )
