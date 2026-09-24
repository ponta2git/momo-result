package momo.api.domain

import java.nio.charset.StandardCharsets.UTF_8
import java.time.Instant
import java.util.Arrays

/** Neighbours were resolved from the same collection as the selected record. */
final case class RecordNavigation[A](previous: Option[A], next: Option[A])

object RecordNavigation:
  def select[A](ordered: List[A])(matches: A => Boolean): Option[(A, RecordNavigation[A])] =
    ordered.zipWithIndex.find { case (record, _) => matches(record) }.map { case (record, index) =>
      record -> RecordNavigation(ordered.lift(index - 1), ordered.lift(index + 1))
    }

/** Matches PostgreSQL COLLATE "C" and the analysis worker's UTF-8 string ordering. */
object RecordNavigationOrder:
  val utf8: Ordering[String] = (left, right) =>
    Arrays.compareUnsigned(left.getBytes(UTF_8), right.getBytes(UTF_8))

  val heldEvents: Ordering[HeldEvent] = Ordering.by[HeldEvent, (Instant, String)](event =>
    (event.heldAt, event.id.value)
  )(using Ordering.Tuple2(using Ordering[Instant], utf8))

  val matches: Ordering[MatchRecord] =
    Ordering.by[MatchRecord, (Instant, String, Int, String)](record =>
      (record.playedAt, record.heldEventId.value, record.matchNoInEvent.value, record.id.value)
    )(using Ordering.Tuple4(using Ordering[Instant], utf8, Ordering.Int, utf8))
