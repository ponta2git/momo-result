package momo.api.adapters.postgres

import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import io.circe.Json

import momo.api.adapters.postgres.CanonicalIdentity.Entity
import momo.api.domain.MatchNoteBody
import momo.api.errors.AppError

/**
 * Adds each evidence match's saved note to a validated expected-rank-gap drilldown.
 *
 * Notes are display metadata read at response time: they are not part of the artifact, its
 * checksum, or the evidence selection, and a note-only save never recalculates the analysis.
 */
private[postgres] object PostgresSeriesAnalysisEvidenceNotes:
  private val EvidenceKind = "expected_rank_gap_evidence"
  private val Sides = List("above", "below")

  private def isEvidence(payload: Json): Boolean =
    payload.hcursor.downField("payload").get[String]("kind").contains(EvidenceKind)

  def matchIds(payload: Json): List[String] =
    if !isEvidence(payload) then Nil
    else
      Sides.flatMap(side =>
        payload.hcursor.downField("payload").downField(side).focus.flatMap(_.asArray).toList
          .flatten.flatMap(_.hcursor.get[String]("matchId").toOption)
      ).distinct

  def read(matchIds: List[String])(using
      identities: PostgresIdentities): ConnectionIO[Either[AppError, Map[String, String]]] =
    if matchIds.isEmpty then Map.empty[String, String].asRight[AppError].pure[ConnectionIO]
    else
      val ids = identities.lookupArray(Entity.Matches, matchIds)
      val limit = MatchNoteBody.MaximumCodePoints
      fr"""
        SELECT ${identities.wireId("m")}, m.note_body, char_length(m.note_body) <= $limit
        FROM matches m
        WHERE m.id = ANY($ids) AND m.note_body IS NOT NULL
      """.query[(String, String, Boolean)].to[List].map(rows =>
        Either.cond(
          rows.forall(_._3),
          rows.map(row => row._1 -> row._2).toMap,
          AppError.Internal("A saved match note exceeds its bound."),
        )
      )

  /** Every evidence row receives `note`: the saved body, or null when the match has none. */
  def hydrate(payload: Json, notes: Map[String, String]): Json =
    if !isEvidence(payload) then payload
    else
      payload.mapObject(root =>
        root("payload").fold(root)(detail =>
          root.add(
            "payload",
            detail.mapObject(fields =>
              Sides.foldLeft(fields)((current, side) =>
                current(side).flatMap(_.asArray).fold(current)(rows =>
                  current.add(side, Json.fromValues(rows.map(withNote(_, notes))))
                )
              )
            ),
          )
        )
      )

  private def withNote(row: Json, notes: Map[String, String]): Json = row.mapObject(fields =>
    val note = fields("matchId").flatMap(_.asString).flatMap(notes.get)
    fields.add("note", note.fold(Json.Null)(Json.fromString))
  )

  /** Nodes added by [[hydrate]]: one `note` value per evidence row. */
  def addedNodeCount(payload: Json): Int =
    if !isEvidence(payload) then 0
    else
      Sides.map(side =>
        payload.hcursor.downField("payload").downField(side).focus.flatMap(_.asArray)
          .fold(0)(_.size)
      ).sum

end PostgresSeriesAnalysisEvidenceNotes
