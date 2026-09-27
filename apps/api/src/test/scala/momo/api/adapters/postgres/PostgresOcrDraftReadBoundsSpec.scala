package momo.api.adapters.postgres

import java.time.Instant

import cats.effect.IO
import cats.syntax.all.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import io.circe.parser.parse

import momo.api.domain.ids.OcrDraftId
import momo.api.errors.AppException
import momo.api.integration.IntegrationSuite

final class PostgresOcrDraftReadBoundsSpec extends IntegrationSuite:
  private val at = Instant.parse("2026-09-26T00:00:00Z")
  private def repo = PostgresOcrDraftsRepository[IO](transactor)

  test("oversized saved JSON is replaced by SQL NULL before single or bulk JDBC materialization") {
    val cases = List(
      ("oversized-payload", PostgresOcrDrafts.MaximumDraftJsonBytes.toInt, 0, 0),
      ("oversized-warnings", 0, PostgresOcrDrafts.MaximumDraftJsonBytes.toInt, 0),
      ("oversized-timings", 0, 0, PostgresOcrDrafts.MaximumDraftJsonBytes.toInt),
    )
    for
      _ <- insert("normal", 8, 8, 8)
      _ <- cases.traverse_ { case (id, payload, warnings, timings) =>
        for
          _ <- insert(id, payload, warnings, timings)
          savedBytes <- storedJsonBytes(id)
          selected <- PostgresOcrDrafts.boundedRows(List(draftId(id), draftId("normal")))
            .transact(transactor)
          singleFailure <- repo.find(draftId(id)).attempt
          bulkFailure <- repo.findMany(List(draftId(id), draftId("normal"))).attempt
        yield
          assert(savedBytes > PostgresOcrDrafts.MaximumDraftJsonBytes)
          assertEquals(selected.size, 2)
          assert(selected.forall(_.isEmpty), "oversized JSON must never be returned by the query")
          assertTooLarge(singleFailure)
          assertTooLarge(bulkFailure)
      }
    yield ()
  }

  test(
    "the aggregate budget includes every requested occurrence without transferring partial payloads"
  ) {
    val portion = (PostgresOcrDrafts.MaximumDraftJsonBytes * 3L / 4L).toInt
    val ids = List("budget-a", "budget-b", "budget-c")
    for
      _ <- ids.traverse_(id => insert(id, portion, 0, 0))
      one <- repo.find(draftId("budget-a"))
      distinctRows <- PostgresOcrDrafts.boundedRows(ids.map(draftId)).transact(transactor)
      duplicateRows <- PostgresOcrDrafts.boundedRows(List.fill(3)(draftId("budget-a")))
        .transact(transactor)
      distinctFailure <- repo.findMany(ids.map(draftId)).attempt
      duplicateFailure <- repo.findMany(List.fill(3)(draftId("budget-a"))).attempt
    yield
      assert(one.isDefined)
      assertEquals(distinctRows.size, 3)
      assert(distinctRows.forall(_.isEmpty))
      assertEquals(duplicateRows.size, 1)
      assert(duplicateRows.forall(_.isEmpty))
      assertTooLarge(distinctFailure)
      assertTooLarge(duplicateFailure)
  }

  test("UTF-8 byte limits apply before decoding and normal twenty-draft bulk reads preserve JSON") {
    val normalIds = (1 to 20).toList.map(index => s"normal-$index")
    val unicodeId = "oversized-utf8"
    val repetitions = (PostgresOcrDrafts.MaximumDraftJsonBytes / 3L).toInt
    for
      _ <- normalIds.traverse_(id => insert(id, 16, 8, 4))
      normal <- repo.findMany(normalIds.map(draftId))
      _ <- insert(unicodeId, 0, 0, 0)
      _ <-
        sql"""UPDATE ocr_drafts SET payload_json = jsonb_build_object('raw', repeat('あ', $repetitions))
                  WHERE id = $unicodeId""".update.run.transact(transactor)
      bytes <- storedJsonBytes(unicodeId)
      hidden <- PostgresOcrDrafts.boundedRows(List(draftId(unicodeId))).transact(transactor)
      rejected <- repo.find(draftId(unicodeId)).attempt
    yield
      assertEquals(normal.size, 20)
      normal.values.foreach { draft =>
        assertEquals(
          parse(draft.payloadJson).toOption.flatMap(_.hcursor.get[String]("raw").toOption),
          Some("p" * 16)
        )
        assertEquals(parse(draft.warningsJson).toOption.flatMap(_.asArray).map(_.size), Some(1))
        assertEquals(
          parse(draft.timingsMsJson).toOption.flatMap(_.hcursor.get[String]("value").toOption),
          Some("t" * 4)
        )
      }
      assert(bytes > PostgresOcrDrafts.MaximumDraftJsonBytes)
      assertEquals(hidden.size, 1)
      assert(hidden.forall(_.isEmpty))
      assertTooLarge(rejected)
  }

  private def draftId(value: String): OcrDraftId = OcrDraftId.unsafeFromString(value)

  private def insert(id: String, payload: Int, warnings: Int, timings: Int): IO[Int] = sql"""
    INSERT INTO ocr_drafts (
      id, job_id, requested_screen_type, payload_json, warnings_json, timings_ms_json,
      created_at, updated_at
    ) VALUES (
      $id, ${s"job-$id"}, 'total_assets',
      jsonb_build_object('raw', repeat('p', $payload)),
      jsonb_build_array(repeat('w', $warnings)),
      jsonb_build_object('value', repeat('t', $timings)), $at, $at
    )
  """.update.run.transact(transactor)

  private def storedJsonBytes(id: String): IO[Long] = sql"""
    SELECT octet_length(payload_json::text)::bigint +
           octet_length(warnings_json::text)::bigint +
           octet_length(timings_ms_json::text)::bigint
    FROM ocr_drafts WHERE id = $id
  """.query[Long].unique.transact(transactor)

  private def assertTooLarge[A](result: Either[Throwable, A]): Unit = result match
    case Left(error: AppException) => assertEquals(error.error.code, "PAYLOAD_TOO_LARGE")
    case _ => fail("expected bounded OCR storage rejection")
