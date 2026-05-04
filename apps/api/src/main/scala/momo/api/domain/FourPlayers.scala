package momo.api.domain

import cats.data.{EitherNec, NonEmptyChain}
import cats.syntax.all.*

import momo.api.domain.ids.MemberId

/**
 * A set of exactly four [[PlayerResult]] entries with all invariants from
 * `requirements/base.md` §3 enforced at construction time:
 *
 *   - exactly 4 entries
 *   - memberId values are pairwise unique and all from the allowed member set
 *   - playOrder values are a permutation of {1,2,3,4}
 *   - rank values are a permutation of {1,2,3,4}
 *   - incident counts are non-negative
 *
 * Internally backed by a 4-tuple so that pattern matching and field access remain ergonomic.
 * Repository layers reconstructing values from the database use the same smart constructor and
 * raise an internal error if the DB has somehow drifted from these invariants.
 */
final case class FourPlayers(
    p1: PlayerResult,
    p2: PlayerResult,
    p3: PlayerResult,
    p4: PlayerResult,
):
  /** Iteration order matches construction order (i.e. the order of the source list). */
  def toList: List[PlayerResult] = List(p1, p2, p3, p4)

  /** Players sorted ascending by playOrder (1..4). */
  def byPlayOrder: List[PlayerResult] = toList.sortBy(_.playOrder)

  /** Players sorted ascending by rank (1..4). */
  def byRank: List[PlayerResult] = toList.sortBy(_.rank)

  def memberIds: Set[MemberId] = toList.iterator.map(_.memberId).toSet

object FourPlayers:
  private val RequiredOrdinals: Set[Int] = Set(1, 2, 3, 4)

  /**
   * Validate a list of [[PlayerResult]] and produce a [[FourPlayers]]. Errors are accumulated via
   * `EitherNec` so callers see every problem at once.
   */
  def fromList(
      players: List[PlayerResult],
      allowedMemberIds: Set[MemberId],
  ): EitherNec[MatchValidationError, FourPlayers] =
    if players.length != 4 then
      MatchValidationError.PlayerCountMismatch(players.length).leftNec
    else
      val memberSet = players.iterator.map(_.memberId).toSet
      val playOrders = players.iterator.map(_.playOrder).toSet
      val ranks = players.iterator.map(_.rank).toSet
      val negativeIncidents = players.iterator
        .filter(p => !hasNonNegativeIncidentCounts(p))
        .map(p => MatchValidationError.IncidentCountsNegative(p.memberId)).toList

      val errs = List.newBuilder[MatchValidationError]
      if memberSet.size != 4 then errs += MatchValidationError.PlayerMemberIdsNotUnique
      if memberSet.size == 4 && !memberSet.subsetOf(allowedMemberIds) then
        errs += MatchValidationError.PlayerMemberIdsNotAllowed(memberSet, allowedMemberIds)
      if playOrders != RequiredOrdinals then errs += MatchValidationError.PlayOrdersNotPermutation
      if ranks != RequiredOrdinals then errs += MatchValidationError.RanksNotPermutation
      negativeIncidents.foreach(errs += _)

      val errors = errs.result()
      NonEmptyChain.fromSeq(errors) match
        case Some(chain) => chain.asLeft
        case None => players match
            case a :: b :: c :: d :: Nil => Right(FourPlayers(a, b, c, d))
            case _ => MatchValidationError.PlayerCountMismatch(players.length).leftNec

  /**
   * Internal reconstruction from a trusted source (DB row). Returns a `Right` only if the row
   * already satisfies every invariant — repositories raise an internal error on `Left`.
   *
   * We use the empty allowed-member set here intentionally: the database already enforces
   * `member_id` references via FK, so we skip the membership check by passing every encountered
   * memberId as allowed. Other invariants (count, permutations, non-negative) still apply.
   */
  def fromTrustedRow(players: List[PlayerResult]): EitherNec[MatchValidationError, FourPlayers] =
    fromList(players, players.iterator.map(_.memberId).toSet)

  private def hasNonNegativeIncidentCounts(p: PlayerResult): Boolean =
    p.incidents.destination >= 0 && p.incidents.plusStation >= 0 &&
      p.incidents.minusStation >= 0 && p.incidents.cardStation >= 0 &&
      p.incidents.cardShop >= 0 && p.incidents.suriNoGinji >= 0
