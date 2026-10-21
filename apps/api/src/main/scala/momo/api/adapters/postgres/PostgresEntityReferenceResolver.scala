package momo.api.adapters.postgres

import cats.effect.MonadCancelThrow
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.repositories.EntityReferenceResolver
import momo.api.repositories.EntityReferenceResolver.{Kind, Resolved}

/** One bounded read for a command's references; unknown input never receives a generated identity. */
final class PostgresEntityReferenceResolver[F[_]: MonadCancelThrow](
    transactor: Transactor[F],
    identities: PostgresIdentities
) extends EntityReferenceResolver[F]:
  def resolve(references: List[(Kind, String)]): F[Resolved] =
    val distinct = references.distinct
    if identities == PostgresIdentities.Legacy || distinct.isEmpty || distinct.size > 64 then
      Resolved(Map.empty).pure[F]
    else
      distinct.zipWithIndex.map { case ((kind, raw), index) =>
        val selected = identities.wireReference(entity(kind), identities.lookup(entity(kind), raw))
        fr"SELECT $index, COALESCE($selected, $raw)"
      }.intercalate(fr"UNION ALL").query[(Int, String)].to[List]
        .map(rows => Resolved(rows.map((index, value) => distinct(index) -> value).toMap))
        .transact(transactor)

  private def entity(kind: Kind): Entity = kind match
    case Kind.Member => Entity.Members
    case Kind.HeldEvent => Entity.HeldEvents
    case Kind.GameTitle => Entity.GameTitles
    case Kind.MapMaster => Entity.MapMasters
    case Kind.SeasonMaster => Entity.SeasonMasters
    case Kind.MatchDraft => Entity.MatchDrafts
    case Kind.OcrDraft => Entity.OcrDrafts
