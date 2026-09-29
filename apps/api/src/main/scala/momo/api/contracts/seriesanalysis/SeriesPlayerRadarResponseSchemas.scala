package momo.api.contracts.seriesanalysis

import java.nio.charset.StandardCharsets

import io.circe.Json
import io.circe.parser.parse

/** Only envelope metadata is API-owned. Every calculated shape comes from the Rust schema. */
private[api] object SeriesPlayerRadarResponseSchemas:
  val StateComponent = "SeriesPlayerRadarStateResponse"
  val PreviewComponent = "SeriesPlayerRadarPreviewResponse"

  private val text = Json.obj(
    "type" -> Json.fromString("string"),
    "minLength" -> Json.fromInt(1),
    "maxLength" -> Json.fromInt(4096)
  )
  private val revision = Json.obj(
    "type" -> Json.fromString("string"),
    "pattern" -> Json.fromString("^(0|[1-9][0-9]*)$")
  )
  private val count = Json.obj("type" -> Json.fromString("integer"), "minimum" -> Json.fromInt(0))
  private val version = Json.obj("type" -> Json.fromString("integer"), "const" -> Json.fromInt(1))
  private def nullable(value: Json): Json = Json.obj("anyOf" -> Json.arr(
    value,
    Json.obj("type" -> Json.fromString("null"))
  ))
  private def values(items: String*): Json = Json.obj(
    "type" -> Json.fromString("string"),
    "enum" -> Json.fromValues(items.map(Json.fromString))
  )
  private def list(item: Json, maximum: Int): Json = Json.obj(
    "type" -> Json.fromString("array"),
    "items" -> item,
    "maxItems" -> Json.fromInt(maximum)
  )
  private def record(fields: (String, Json)*): Json = Json.obj(
    "type" -> Json.fromString("object"),
    "additionalProperties" -> Json.False,
    "properties" -> Json.obj(fields*),
    "required" -> Json.fromValues(fields.map(value => Json.fromString(value._1)))
  )

  private val basis = record(
    "basisId" -> text,
    "checksum" -> text,
    "createdAt" -> text,
    "appliedAt" -> nullable(text),
    "sourceInputRevision" -> revision,
    "basis" -> owner("basis")
  )
  private val previewMetadata = record(
    "previewId" -> text,
    "beforeBasisId" -> nullable(text),
    "inputRevision" -> revision,
    "status" -> values("pending", "ready", "stale", "failed"),
    "createdAt" -> text
  )
  private val candidate = record(
    "candidateId" -> text,
    "status" ->
      values("pending", "ready", "unavailable", "invalid", "withdrawn", "applied", "failed"),
    "basisId" -> nullable(text),
    "sourceInputRevision" -> nullable(revision),
    "safeFailureCode" -> nullable(text),
    "createdAt" -> text,
    "updatedAt" -> text,
    "result" -> nullable(owner("candidate")),
    "latestPreview" -> nullable(previewMetadata)
  )

  def state(operationSchema: Json): Json = record(
    "schemaVersion" -> version,
    "gameTitleId" -> text,
    "inputRevision" -> revision,
    "generation" -> revision,
    "currentBasis" -> nullable(basis),
    "previousBasis" -> nullable(basis),
    "candidate" -> nullable(candidate),
    "operations" -> list(operationSchema, 10),
    "monitor" -> nullable(owner("monitoring")),
    "acknowledgedEvidenceKeys" -> list(text, 64),
    "eligibility" -> record("matchCount" -> count, "heldEventCount" -> count)
  )

  val preview: Json = record(
    "schemaVersion" -> version,
    "gameTitleId" -> text,
    "previewId" -> text,
    "candidateId" -> text,
    "inputRevision" -> revision,
    "currentInputRevision" -> revision,
    "beforeBasisId" -> nullable(text),
    "candidateBasisId" -> nullable(text),
    "status" -> values("pending", "ready", "stale", "failed", "invalid"),
    "createdAt" -> text,
    "scope" -> record(
      "kind" -> values("overall", "season", "map", "season_map"),
      "key" -> text,
      "seasonMasterId" -> nullable(text),
      "mapMasterId" -> nullable(text),
      "displayName" -> text,
      "state" -> values("available", "empty", "awaiting_analysis")
    ),
    "before" -> nullable(owner("evaluation")),
    "after" -> nullable(owner("evaluation"))
  )

  private def owner(kind: String): Json =
    val path = s"/momo/api/series-analysis-schemas/series-player-radar-$kind-v1.schema.json"
    val stream = Option(getClass.getResourceAsStream(path))
      .getOrElse(sys.error(s"Radar owner schema is missing: $path"))
    try parse(new String(stream.readAllBytes(), StandardCharsets.UTF_8)).fold(
        error => sys.error(s"Invalid radar schema: ${error.message}"),
        _.mapObject(_.remove("$id").remove("$schema").remove("$comment")),
      )
    finally stream.close()
