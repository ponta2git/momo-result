package momo.api.adapters.postgres

import java.io.ByteArrayInputStream
import java.nio.charset.StandardCharsets

import com.networknt.schema.dialect.{Dialect, Dialects}
import com.networknt.schema.keyword.NonValidationKeyword
import com.networknt.schema.serialization.NodeReader
import com.networknt.schema.{InputFormat, OutputFormat, Schema, SchemaLocation}
import io.circe.Json

/** Checks stored shapes only. Rust remains responsible for statistical and snapshot semantics. */
private[postgres] object SeriesPlayerRadarPayloadValidator:
  private val dialect = Dialect.builder(Dialects.getDraft202012())
    .keyword(new NonValidationKeyword("x-momo-finiteF64"))
    .keyword(new NonValidationKeyword("x-momo-integerToken"))
    .keyword(new NonValidationKeyword("x-momo-maxUtf8Bytes"))
    .build()
  private val registry = com.networknt.schema.SchemaRegistry.withDialect(dialect)
  private val reader = NodeReader.builder().build()
  private val schemas: Map[String, Schema] = List("basis", "candidate", "evaluation", "monitoring")
    .map { kind =>
      val schema = registry.getSchema(SchemaLocation.of(
        s"classpath:momo/api/series-analysis-schemas/series-player-radar-$kind-v1.schema.json"))
      schema.initializeValidators()
      kind -> schema
    }.toMap

  def ensureReady(): Unit = schemas.values.foreach(_.initializeValidators())

  def validate(document: Json): Boolean =
    val cursor = document.hcursor
    val fragments = List(
      "basis" -> cursor.downField("currentBasis").downField("basis").focus,
      "basis" -> cursor.downField("previousBasis").downField("basis").focus,
      "candidate" -> cursor.downField("candidate").downField("result").focus,
      "monitoring" -> cursor.downField("monitor").focus,
      "evaluation" -> cursor.downField("before").focus,
      "evaluation" -> cursor.downField("after").focus,
    )
    fragments.forall { case (kind, fragment) => fragment.filterNot(_.isNull).forall { value =>
        val bytes = value.noSpaces.getBytes(StandardCharsets.UTF_8)
        val node = reader.readTree(new ByteArrayInputStream(bytes), InputFormat.JSON)
        schemas(kind).validate(node, OutputFormat.BOOLEAN).booleanValue()
      }
    }
