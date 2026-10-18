package momo.api.repositories

import cats.Applicative
import cats.syntax.all.*

/** Resolve existing aliases after request hashing and before domain identity comparisons. */
trait EntityReferenceResolver[F[_]]:
  def resolve(references: List[(EntityReferenceResolver.Kind, String)])
      : F[EntityReferenceResolver.Resolved]

object EntityReferenceResolver:
  enum Kind derives CanEqual:
    case Member, HeldEvent, GameTitle, MapMaster, SeasonMaster, MatchDraft, OcrDraft

  final case class Resolved(values: Map[(Kind, String), String]):
    def apply(kind: Kind, raw: String): String = values.getOrElse(kind -> raw, raw)

  def preserve[F[_]: Applicative]: EntityReferenceResolver[F] = new EntityReferenceResolver[F]:
    def resolve(references: List[(Kind, String)]): F[Resolved] = Resolved(Map.empty).pure[F]
