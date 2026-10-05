package momo.api.integration

import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.security.MessageDigest
import java.time.Instant

import cats.effect.IO
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import io.circe.Json
import io.circe.parser.parse

import momo.api.adapters.postgres.PostgresMeta.given
import momo.api.adapters.postgres.{PostgresGameTitlesRepository, PostgresSeriesAnalysisRepository}
import momo.api.config.SeriesAnalysisReadConfig
import momo.api.contracts.seriesanalysis.SeriesAnalysisArtifactContract
import momo.api.domain.*
import momo.api.domain.ids.{GameTitleId, MemberId}
import momo.api.errors.AppError
import momo.api.testing.JsonSchemaAssertions

final class PostgresSeriesAnalysisOutlookSpec extends IntegrationSuite with JsonSchemaAssertions:
  private val title = GameTitleId.unsafeFromString("title-outlook-read")
  private val member = MemberId.unsafeFromString("member_ponta")
  private val artifactId = "artifact-outlook-read"

  test("a zero-game overall summary remains readable outside the aggregate scope index"):
    val summary = withTitle(fixture("outlook-summary-empty-payload-v1.json"))
    for
      _ <- seed(Some(summary), None)
      repository <- PostgresSeriesAnalysisRepository.create[IO](transactor, SeriesAnalysisReadConfig.defaults)
      result <- repository.chunk(request(SeriesAnalysisChunkKind.OutlookSummary))
    yield
      val response = json(result)
      assertEquals(response.hcursor.get[String]("qualityStatus"), Right("no_target"))
      assertEquals(response.hcursor.downField("scope").get[Int]("matchCount"), Right(0))
      assertEquals(response.hcursor.get[Vector[Json]]("players"), Right(Vector.empty))
      assertEquals(response.hcursor.downField("scope").get[String]("displayName"), Right("総合"))

  test("stored reference reads project bounded windows and examples with pinned identity and current names"):
    val reference = withTitle(fixture("outlook-reference-payload-v1.json"))
      .mapObject(_.add("memberId", Json.fromString(member.value)))
    val count = reference.hcursor.downField("source").get[Int]("titleMatchCount").toOption.get
    val read = request(SeriesAnalysisChunkKind.OutlookReference).copy(memberId = Some(member))
    for
      _ <- seed(None, Some(reference))
      repository <- PostgresSeriesAnalysisRepository.create[IO](transactor, SeriesAnalysisReadConfig.defaults)
      name <- sql"SELECT display_name FROM members WHERE id = $member".query[String].unique.transact(transactor)
      window <- repository.chunk(read.copy(projection = SeriesAnalysisChunkProjection.OutlookWindow(1)))
      insufficient <- repository.chunk(read.copy(projection = SeriesAnalysisChunkProjection.OutlookWindow(count + 1)))
      examples <- repository.chunk(read.copy(projection = SeriesAnalysisChunkProjection.OutlookExamples))
      expired <- repository.chunk(read.copy(artifactId = "other-artifact"))
      unknown <- repository.chunk(read.copy(memberId = Some(MemberId.unsafeFromString("unknown-member"))))
    yield
      val result = json(window)
      assertEquals(result.hcursor.get[String]("displayName"), Right(name))
      assertEquals(result.hcursor.get[String]("status"), Right("available"))
      assertEquals(result.hcursor.downField("window").get[Int]("windowSize"), Right(1))
      assertEquals(result.hcursor.downField("artifact").get[String]("artifactId"), Right(artifactId))
      assertEquals(result.hcursor.downField("source").get[String]("gameTitleId"), Right(title.value))
      assert(!result.asObject.get.contains("bestWindows"))
      assertEquals(json(insufficient).hcursor.get[String]("status"), Right("insufficient"))
      assertEquals(json(insufficient).hcursor.downField("window").focus, Some(Json.Null))
      assertEquals(json(examples).hcursor.downField("examples").focus, reference.hcursor.downField("examples").focus)
      assertEquals(expired, Left(AppError.AnalysisArtifactExpired()))
      assertEquals(unknown, Left(AppError.NotFound("member", "unknown-member")))

  private def seed(summary: Option[Json], reference: Option[Json]): IO[Unit] =
    val version = SeriesAnalysisArtifactContract.ArtifactSchemaVersion
    val contract = SeriesAnalysisArtifactContract.ValidationContractId
    val aggregateCount = 1
    val summaryPayload = summary.getOrElse(withTitle(fixture("outlook-summary-payload-v1.json")))
    val referencePayloads = reference.toList.flatMap(value =>
      List("member_ponta", "member_eu", "member_akane_mami", "member_otaka").map { id =>
        MemberId.unsafeFromString(id) -> value.mapObject(_.add("memberId", Json.fromString(id)))
      }
    )
    val keys = if reference.isDefined then Array("overall") else Array.empty[String]
    val allBytes = (summaryPayload :: referencePayloads.map(_._2)).map(bytes(_).length.toLong).sum + aggregateCount * 2
    val header = sql"""
      INSERT INTO series_analysis_artifacts (
        id, game_title_id, input_revision, algorithm_version, artifact_schema_version,
        source_input_checksum, root_checksum, status, aggregate_chunk_count, review_chunk_count,
        drilldown_chunk_count, match_context_chunk_count, outlook_summary_chunk_count,
        outlook_reference_chunk_count, encoded_bytes, decoded_bytes, scope_keys
      ) VALUES ($artifactId, $title, 0, 'series-analysis-v7', $version,
        'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        'staging', $aggregateCount, 0, 0, 0, 1, ${referencePayloads.size}, $allBytes, $allBytes, $keys)
    """.update.run.void
    val aggregate =
      val payload = "{}".getBytes(StandardCharsets.UTF_8)
      sql"""INSERT INTO series_analysis_scope_aggregate_artifacts (
        artifact_id, scope_key, scope_kind, payload, encoded_bytes, decoded_bytes, item_count, nesting_depth, checksum
      ) VALUES ($artifactId, 'overall', 'overall', $payload, 2, 2, 0, 1, ${checksum(payload)})""".update.run.void
    val summaries = List(summaryPayload).traverse_ { value =>
      val payload = bytes(value)
      val items = value.hcursor.get[Vector[Json]]("players").toOption.get.size
      sql"""INSERT INTO series_analysis_outlook_summary_artifacts (
        artifact_id, scope_key, scope_kind, payload, encoded_bytes, decoded_bytes, item_count, nesting_depth, checksum
      ) VALUES ($artifactId, 'overall', 'overall', $payload, ${payload.length}, ${payload.length},
        $items, ${depth(value)}, ${checksum(payload)})""".update.run.void
    }
    val references = referencePayloads.traverse_ { case (memberId, value) =>
      val payload = bytes(value)
      val items = value.hcursor.get[Vector[Json]]("bestWindows").toOption.get.size +
        value.hcursor.downField("examples").get[Vector[Json]]("types").toOption.get.size
      sql"""INSERT INTO series_analysis_outlook_reference_artifacts (
        artifact_id, scope_key, scope_kind, member_id, payload, encoded_bytes, decoded_bytes,
        item_count, nesting_depth, checksum
      ) VALUES ($artifactId, 'overall', 'overall', $memberId, $payload, ${payload.length}, ${payload.length},
        $items, ${depth(value)}, ${checksum(payload)})""".update.run.void
    }
    val publish = sql"""UPDATE series_analysis_artifacts SET validation_contract_id = $contract
      WHERE id = $artifactId""".update.run *> sql"""
      UPDATE series_analysis_artifacts SET status = 'published', published_at = now() WHERE id = $artifactId
    """.update.run *> sql"""UPDATE series_analysis_title_states SET current_artifact_id = $artifactId,
      pending_work = false WHERE game_title_id = $title""".update.run.void
    new PostgresGameTitlesRepository[IO](transactor).createWithNextDisplayOrder(
      GameTitle(title, "見通し読取", "momotetsu2", 1, Instant.parse("2026-01-01T00:00:00Z"))) *>
      (header *> aggregate *> summaries *> references *> publish).transact(transactor)

  private def request(kind: SeriesAnalysisChunkKind): SeriesAnalysisChunkRequest =
    SeriesAnalysisChunkRequest(kind, title, artifactId, SeriesAnalysisScope.Overall)
  private def json(result: Either[AppError, SeriesAnalysisChunk]): Json = result
    .flatMap(value => parse(new String(value.payload, StandardCharsets.UTF_8))
      .leftMap(error => AppError.Internal(error.toString))).fold(error => fail(error.toString), identity)
  private def withTitle(value: Json): Json = value.hcursor.downField("source")
    .withFocus(_.mapObject(_.add("gameTitleId", Json.fromString(title.value)))).top.get
  private def fixture(name: String): Json = parse(Files.readString(repositoryFile(
    s"docs/schemas/fixtures/series-analysis/$name"))).fold(error => fail(error.toString), identity)
  private def bytes(value: Json): Array[Byte] = value.noSpaces.getBytes(StandardCharsets.UTF_8)
  private def checksum(value: Array[Byte]): String = "sha256:" +
    MessageDigest.getInstance("SHA-256").digest(value).map(b => f"${b & 0xff}%02x").mkString
  private def depth(value: Json): Int = value.arrayOrObject(1,
    values => 1 + values.map(depth).maxOption.getOrElse(0),
    fields => 1 + fields.values.map(depth).maxOption.getOrElse(0))
