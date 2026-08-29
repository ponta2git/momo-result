package momo.api.contracts.seriesanalysis

import java.nio.charset.StandardCharsets

import io.circe.parser.parse
import io.circe.{Json, JsonObject}

import momo.api.domain.SeriesAnalysisMatchContextExclusion

private[api] object SeriesAnalysisResponseSchemas:
  private val SchemaResourceDirectory = "/momo/api/series-analysis-schemas"
  private val Draft202012 = "https://json-schema.org/draft/2020-12/schema"

  private val TextSchema = Json.obj(
    "maxLength" -> Json.fromInt(4096),
    "minLength" -> Json.fromInt(1),
    "type" -> Json.fromString("string"),
    "x-momo-maxUtf8Bytes" -> Json.fromInt(4096),
  )
  private val DisplayNameSchema = Json.obj(
    "minLength" -> Json.fromInt(1),
    "type" -> Json.fromString("string"),
  )
  private val ArtifactSchema = objectSchema(
    List(
      "algorithmVersion" -> TextSchema,
      "artifactId" -> TextSchema,
      "artifactSchemaVersion" -> Json.obj(
        "minimum" -> Json.fromInt(0),
        "type" -> Json.fromString("integer"),
      ),
      "gameTitleId" -> TextSchema,
      "inputRevision" -> Json.obj(
        "pattern" -> Json.fromString("^(0|[1-9][0-9]*)$"),
        "type" -> Json.fromString("string"),
      ),
      "publishedAt" -> TextSchema,
    )
  )
  private val IncludedSchema = objectSchema(
    List(
      "sourceMatchRevision" -> Json.obj(
        "pattern" -> Json.fromString("^(0|[1-9][0-9]*)$"),
        "type" -> Json.fromString("string"),
      ),
      "status" -> Json.obj(
        "const" -> Json.fromString("included"),
        "type" -> Json.fromString("string"),
      ),
    )
  )
  private val ExcludedInclusionSchema = objectSchema(
    List(
      "status" -> Json.obj(
        "enum" -> Json.arr(
          SeriesAnalysisMatchContextExclusion.values.map(value => Json.fromString(value.wire))*
        ),
        "type" -> Json.fromString("string"),
      )
    )
  )

  val aggregate: Resource = Resource(
    "aggregate",
    "aggregate",
    "SeriesAnalysisAggregateResponse",
    "series-analysis-aggregate-v3.schema.json",
    "series-analysis-aggregate-response-v2.schema.json",
    matchContext = false,
  )
  val drilldown: Resource = Resource(
    "drilldown",
    "drilldown",
    "SeriesAnalysisDrilldownResponse",
    "series-analysis-drilldown-v3.schema.json",
    "series-analysis-drilldown-response-v2.schema.json",
    matchContext = false,
  )
  val matchContext: Resource = Resource(
    "match-context",
    "matchContext",
    "SeriesAnalysisMatchContextResponse",
    "series-analysis-match-context-v1.schema.json",
    "series-analysis-match-context-response-v2.schema.json",
    matchContext = true,
  )
  val review: Resource = Resource(
    "review",
    "review",
    "SeriesAnalysisReviewResponse",
    "series-analysis-review-v3.schema.json",
    "series-analysis-review-response-v2.schema.json",
    matchContext = false,
  )

  val resources: List[Resource] = List(aggregate, drilldown, matchContext, review)

  def schemaFor(resource: Resource): Json =
    val registered = resources.find(_.componentName == resource.componentName).getOrElse(
      sys.error(s"Unknown series analysis response component: ${resource.componentName}")
    )
    if registered ne resource then
      sys.error(s"Conflicting series analysis response component: ${resource.componentName}")
    val owner = loadSchema(resource.ownerFile)
    if resource.matchContext then matchContextResponseSchema(owner, resource)
    else responseSchema(owner, resource)

  final case class Resource private[seriesanalysis] (
      pathSegment: String,
      kind: String,
      componentName: String,
      ownerFile: String,
      outputFile: String,
      matchContext: Boolean,
  )

  private def responseSchema(owner: Json, resource: Resource): Json =
    val memberHydrated = addMemberDisplayNames(owner)
    withMetadata(mapBranches(memberHydrated)(addResponseEnvelope), resource)

  private def matchContextResponseSchema(owner: Json, resource: Resource): Json =
    val includedBase = owner.mapObject(
      _.remove("$comment").remove("$id").remove("$schema")
    )
    val includedEnvelope = addResponseEnvelope(addMemberDisplayNames(includedBase))
    val withoutRevision = removeProperty(
      includedEnvelope,
      "sourceMatchRevision",
      "included match context",
    )
    val included = addProperty(
      withoutRevision,
      "inclusion",
      IncludedSchema,
      "included match context",
    )
    val excludedScope = mapBranches(
      requiredProperty(owner, "scope", "match-context owner")
    )(branch =>
      removeProperty(
        addProperty(branch, "displayName", DisplayNameSchema, "excluded scope"),
        "matchCount",
        "excluded scope",
      )
    )
    val excluded = objectSchema(
      List(
        "artifact" -> ArtifactSchema,
        "inclusion" -> ExcludedInclusionSchema,
        "match" -> Json.obj("type" -> Json.fromString("null")),
        "matchId" -> requiredProperty(owner, "matchId", "match-context owner"),
        "schemaVersion" -> requiredProperty(
          owner,
          "schemaVersion",
          "match-context owner",
        ),
        "scope" -> excludedScope,
      )
    )
    withMetadata(
      Json.obj("oneOf" -> Json.arr(included, excluded)),
      resource,
    )

  private def addMemberDisplayNames(value: Json): Json = value.arrayOrObject(
    value,
    values => Json.fromValues(values.map(addMemberDisplayNames)),
    fields =>
      val nested = JsonObject.fromIterable(
        fields.toIterable.map { case (key, child) => key -> addMemberDisplayNames(child) }
      )
      nested("properties").flatMap(_.asObject) match
        case Some(memberProperties) if memberProperties.contains("memberId") =>
          val memberSchema = Json.fromJsonObject(nested)
          if !required(memberSchema, "member object").contains("memberId") then
            sys.error("Series analysis memberId is not required in a projected member object.")
          addProperty(
            memberSchema,
            "displayName",
            DisplayNameSchema,
            "member object",
          )
        case _ => Json.fromJsonObject(nested),
  )

  private def addResponseEnvelope(schema: Json): Json =
    val withArtifact = addProperty(schema, "artifact", ArtifactSchema, "response root")
    val scope = requiredProperty(withArtifact, "scope", "response root")
    val hydratedScope = mapBranches(scope)(branch =>
      addProperty(branch, "displayName", DisplayNameSchema, "response scope")
    )
    replaceProperty(withArtifact, "scope", hydratedScope, "response root")

  private def addProperty(
      schema: Json,
      field: String,
      fieldSchema: Json,
      context: String,
  ): Json =
    val schemaObject = objectValue(schema, context)
    val currentProperties = properties(schema, context)
    if currentProperties.contains(field) then
      sys.error(s"Series analysis $context already contains projected field: $field")
    val updated = schemaObject.add(
      "properties",
      Json.fromJsonObject(currentProperties.add(field, fieldSchema)),
    )
    withRequired(Json.fromJsonObject(updated), required(schema, context) :+ field)

  private def replaceProperty(
      schema: Json,
      field: String,
      fieldSchema: Json,
      context: String,
  ): Json =
    val schemaObject = objectValue(schema, context)
    val currentProperties = properties(schema, context)
    if !currentProperties.contains(field) then
      sys.error(s"Series analysis $context is missing projected field: $field")
    Json.fromJsonObject(
      schemaObject.add(
        "properties",
        Json.fromJsonObject(currentProperties.add(field, fieldSchema)),
      )
    )

  private def removeProperty(schema: Json, field: String, context: String): Json =
    val schemaObject = objectValue(schema, context)
    val currentProperties = properties(schema, context)
    if !currentProperties.contains(field) then
      sys.error(s"Series analysis $context is missing removable field: $field")
    val currentRequired = required(schema, context)
    if !currentRequired.contains(field) then
      sys.error(s"Series analysis $context field is not required: $field")
    val updated = schemaObject.add(
      "properties",
      Json.fromJsonObject(currentProperties.remove(field)),
    )
    withRequired(
      Json.fromJsonObject(updated),
      currentRequired.filterNot(_ == field),
    )

  private def mapBranches(schema: Json)(transform: Json => Json): Json =
    val schemaObject = objectValue(schema, "schema branch")
    schemaObject("oneOf") match
      case None => transform(schema)
      case Some(value) =>
        val branches = value.asArray.getOrElse(
          sys.error("Series analysis schema oneOf is not an array.")
        )
        Json.fromJsonObject(
          schemaObject.add("oneOf", Json.fromValues(branches.map(transform)))
        )

  private def properties(schema: Json, context: String): JsonObject =
    objectValue(schema, context)("properties").flatMap(_.asObject).getOrElse(
      sys.error(s"Series analysis $context has no object properties.")
    )

  private def required(schema: Json, context: String): Vector[String] =
    objectValue(schema, context)("required").flatMap(_.asArray).getOrElse(
      sys.error(s"Series analysis $context has no required list.")
    ).map(
      _.asString.getOrElse(
        sys.error(s"Series analysis $context has a non-string required field.")
      )
    )

  private def requiredProperty(
      schema: Json,
      field: String,
      context: String,
  ): Json =
    if !required(schema, context).contains(field) then
      sys.error(s"Series analysis $context property is not required: $field")
    properties(schema, context)(field).getOrElse(
      sys.error(s"Series analysis $context is missing property: $field")
    )

  private def objectValue(value: Json, context: String): JsonObject = value.asObject.getOrElse(
    sys.error(s"Series analysis $context is not an object schema.")
  )

  private def withRequired(schema: Json, fields: Vector[String]): Json = schema.mapObject(
    _.add("required", Json.fromValues(fields.map(Json.fromString)))
  )

  private def withMetadata(schema: Json, resource: Resource): Json = schema.mapObject(
    _.add(
      "$comment",
      Json.fromString(
        "Generated by the API OpenAPI projection from the Rust-owned artifact schema; do not edit by hand."
      ),
    ).add(
      "$id",
      Json.fromString(s"https://momo-result.local/schemas/${resource.outputFile}"),
    ).add("$schema", Json.fromString(Draft202012)).add(
      "x-momo-series-analysis-resource-kind",
      Json.fromString(resource.kind),
    )
  )

  private def objectSchema(fields: List[(String, Json)]): Json = Json.obj(
    "additionalProperties" -> Json.False,
    "properties" -> Json.obj(fields*),
    "required" -> Json.fromValues(fields.map((name, _) => Json.fromString(name))),
    "type" -> Json.fromString("object"),
  )

  private def loadSchema(fileName: String): Json =
    val resourcePath = s"$SchemaResourceDirectory/$fileName"
    val source = Option(getClass.getResourceAsStream(resourcePath)).getOrElse(
      sys.error(s"Series analysis owner schema is missing: $resourcePath")
    )
    try
      parse(new String(source.readAllBytes(), StandardCharsets.UTF_8)).fold(
        error => sys.error(s"Invalid series analysis owner schema $fileName: ${error.message}"),
        identity,
      )
    finally source.close()
