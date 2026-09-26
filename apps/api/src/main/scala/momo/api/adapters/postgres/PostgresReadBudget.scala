package momo.api.adapters.postgres

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*

import momo.api.domain.constraints.TextLimits
import momo.api.errors.{AppError, AppException}

/** Limits materialization at SQL boundaries, including data written before input limits existed. */
private[postgres] object PostgresReadBudget:
  val CatalogRows = 1000
  val ScopeRows = 1000
  // The detail contract returns a whole event. Use the match-list maximum page size as its
  // finite ceiling; larger histories remain accessible through the paginated match endpoint.
  val HeldEventRecords = 200
  val NameCodePoints = TextLimits.NameMaxCodePoints
  val KeyCodePoints = 64

  def rows[A: Read](query: Fragment, maximum: Int, resource: String): ConnectionIO[List[A]] =
    (query ++ fr"LIMIT ${maximum + 1}").query[A].to[List].flatMap { rows =>
      if rows.size <= maximum then rows.pure[ConnectionIO]
      else reject(resource, "too many records")
    }

  /** Each row starts with its text-size guard; SQL must truncate its text before returning it. */
  def guardedRows[A: Read](
      query: Fragment,
      maximum: Int,
      resource: String,
  ): ConnectionIO[List[A]] = rows[(Boolean, A)](query, maximum, resource).flatMap { bounded =>
    if bounded.forall(_._1) then bounded.map(_._2).pure[ConnectionIO]
    else reject(resource, "oversized stored text")
  }

  def reject[A](resource: String, reason: String): ConnectionIO[A] =
    new AppException(AppError.PayloadTooLarge(
      s"$resource exceeds the supported read budget ($reason). Narrow the request or correct the stored data."
    )).raiseError[ConnectionIO, A]

  def ensureCount(count: ConnectionIO[Long], maximum: Int, resource: String): ConnectionIO[Unit] =
    count.flatMap { value =>
      if value <= maximum then ().pure[ConnectionIO]
      else reject(resource, "too many records")
    }

  def ensureText(valid: ConnectionIO[Boolean], resource: String): ConnectionIO[Unit] =
    valid.flatMap {
      case true => ().pure[ConnectionIO]
      case false => reject(resource, "oversized stored text")
    }
