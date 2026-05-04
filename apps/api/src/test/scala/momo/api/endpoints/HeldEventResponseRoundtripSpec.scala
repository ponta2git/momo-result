package momo.api.endpoints

import java.time.Instant

import io.circe.Json
import io.circe.parser.parse
import io.circe.syntax.*
import munit.FunSuite

import momo.api.domain.HeldEvent

/**
 * Roundtrip + golden-JSON guard for [[HeldEventResponse]].
 *
 * The roundtrip part proves that the case class shape is symmetric (encode then decode yields the
 * same value). The golden part pins the wire format: any change to field names, ordering, or types
 * will fail this test, forcing a deliberate decision (and a frontend coordination) before it can
 * be merged. This is what lets later phases (state ADTs, opaque IDs) refactor freely without
 * silently breaking the API contract.
 */
final class HeldEventResponseRoundtripSpec extends FunSuite:

  private val held = HeldEvent("held_2026_04_30", Instant.parse("2026-04-30T12:00:00Z"))
  private val response = HeldEventResponse.from(held, matchCount = 3)

  test("HeldEventResponse: encode → decode is identity"):
    val decoded = response.asJson.as[HeldEventResponse]
    assertEquals(decoded, Right(response))

  test("HeldEventResponse: golden JSON pins the wire format"):
    val golden = parse("""
      {
        "id": "held_2026_04_30",
        "heldAt": "2026-04-30T12:00:00Z",
        "matchCount": 3
      }
    """).getOrElse(Json.Null)
    assertEquals(response.asJson, golden)
end HeldEventResponseRoundtripSpec
