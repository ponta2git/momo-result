package momo.api.domain

opaque type MatchNoInEvent = Int
object MatchNoInEvent:
  def fromInt(value: Int): Either[MatchValidationError, MatchNoInEvent] =
    if value >= 1 then Right(value) else Left(MatchValidationError.MatchNoInEventInvalid(value))

  def unsafeFromInt(value: Int): MatchNoInEvent = fromInt(value)
    .fold(error => sys.error(error.message), identity)

  extension (value: MatchNoInEvent) def value: Int = value

  given Ordering[MatchNoInEvent] = Ordering.Int
  given CanEqual[MatchNoInEvent, MatchNoInEvent] = CanEqual.derived

opaque type PlayOrder = Int
object PlayOrder:
  private val Min = 1
  private val Max = 4

  def fromInt(value: Int): Either[MatchValidationError, PlayOrder] =
    if value >= Min && value <= Max then Right(value)
    else Left(MatchValidationError.PlayOrderInvalid(value))

  def unsafeFromInt(value: Int): PlayOrder = fromInt(value)
    .fold(error => sys.error(error.message), identity)

  extension (value: PlayOrder) def value: Int = value

  given Ordering[PlayOrder] = Ordering.Int
  given CanEqual[PlayOrder, PlayOrder] = CanEqual.derived

opaque type Rank = Int
object Rank:
  private val Min = 1
  private val Max = 4

  def fromInt(value: Int): Either[MatchValidationError, Rank] =
    if value >= Min && value <= Max then Right(value)
    else Left(MatchValidationError.RankInvalid(value))

  def unsafeFromInt(value: Int): Rank = fromInt(value)
    .fold(error => sys.error(error.message), identity)

  extension (value: Rank) def value: Int = value

  given Ordering[Rank] = Ordering.Int
  given CanEqual[Rank, Rank] = CanEqual.derived

opaque type ManYen = Int
object ManYen:
  def fromInt(value: Int): ManYen = value
  def unsafeFromInt(value: Int): ManYen = value

  extension (value: ManYen) def value: Int = value

  given Ordering[ManYen] = Ordering.Int
  given CanEqual[ManYen, ManYen] = CanEqual.derived

opaque type IncidentCount = Int
object IncidentCount:
  def fromInt(value: Int): Either[MatchValidationError, IncidentCount] =
    if value >= 0 then Right(value) else Left(MatchValidationError.IncidentCountInvalid(value))

  def unsafeFromInt(value: Int): IncidentCount = fromInt(value)
    .fold(error => sys.error(error.message), identity)

  extension (value: IncidentCount) def value: Int = value

  given Ordering[IncidentCount] = Ordering.Int
  given CanEqual[IncidentCount, IncidentCount] = CanEqual.derived
