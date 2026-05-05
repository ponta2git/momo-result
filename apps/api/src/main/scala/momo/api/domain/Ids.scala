package momo.api.domain

import java.util.UUID

import cats.effect.std.Random
import cats.syntax.all.*
import cats.{Apply, Eq, Order, Show}

object ids:
  private object IdGenerator:
    def next[F[_]: Apply: Random]: F[String] = (Random[F].nextLong, Random[F].nextLong)
      .mapN((hi, lo) => UUID(hi, lo).toString)

  private[domain] trait IdCompanion[Id]:
    protected def make(s: String): Id
    protected def underlying(id: Id): String
    final def apply(value: String): Id = make(value)
    extension (id: Id) def value: String = underlying(id)
    given Eq[Id] = Eq.instance((a, b) => underlying(a) == underlying(b))
    given Show[Id] = Show.show(underlying)
    given Order[Id] = Order.from((a, b) => underlying(a).compareTo(underlying(b)))
    given CanEqual[Id, Id] = CanEqual.derived
    def fresh[F[_]: Apply: Random]: F[Id] = IdGenerator.next[F].map(apply)

  opaque type OcrJobId = String
  object OcrJobId extends IdCompanion[OcrJobId]:
    protected def make(s: String): OcrJobId = s
    protected def underlying(id: OcrJobId): String = id

  opaque type OcrDraftId = String
  object OcrDraftId extends IdCompanion[OcrDraftId]:
    protected def make(s: String): OcrDraftId = s
    protected def underlying(id: OcrDraftId): String = id

  opaque type ImageId = String
  object ImageId extends IdCompanion[ImageId]:
    protected def make(s: String): ImageId = s
    protected def underlying(id: ImageId): String = id

  opaque type MemberId = String
  object MemberId extends IdCompanion[MemberId]:
    protected def make(s: String): MemberId = s
    protected def underlying(id: MemberId): String = id

  opaque type HeldEventId = String
  object HeldEventId extends IdCompanion[HeldEventId]:
    protected def make(s: String): HeldEventId = s
    protected def underlying(id: HeldEventId): String = id

  opaque type MatchId = String
  object MatchId extends IdCompanion[MatchId]:
    protected def make(s: String): MatchId = s
    protected def underlying(id: MatchId): String = id

  opaque type MatchDraftId = String
  object MatchDraftId extends IdCompanion[MatchDraftId]:
    protected def make(s: String): MatchDraftId = s
    protected def underlying(id: MatchDraftId): String = id

  opaque type GameTitleId = String
  object GameTitleId extends IdCompanion[GameTitleId]:
    protected def make(s: String): GameTitleId = s
    protected def underlying(id: GameTitleId): String = id

  opaque type MapMasterId = String
  object MapMasterId extends IdCompanion[MapMasterId]:
    protected def make(s: String): MapMasterId = s
    protected def underlying(id: MapMasterId): String = id

  opaque type SeasonMasterId = String
  object SeasonMasterId extends IdCompanion[SeasonMasterId]:
    protected def make(s: String): SeasonMasterId = s
    protected def underlying(id: SeasonMasterId): String = id

  opaque type IncidentMasterId = String
  object IncidentMasterId extends IdCompanion[IncidentMasterId]:
    protected def make(s: String): IncidentMasterId = s
    protected def underlying(id: IncidentMasterId): String = id

  opaque type UserId = String
  object UserId extends IdCompanion[UserId]:
    protected def make(s: String): UserId = s
    protected def underlying(id: UserId): String = id
