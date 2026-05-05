package momo.api.endpoints.codec

import io.circe.parser
import io.circe.syntax.*
import munit.FunSuite

import momo.api.domain.{OcrJobHints, PlayerAliasHint}
import momo.api.endpoints.codec.OcrHintsCodec.given

final class OcrHintsCodecSpec extends FunSuite:
  test("encodes an empty OcrJobHints with all-null Option / empty List wire shape") {
    val empty = OcrJobHints()
    val json = empty.asJson.noSpaces

    assertEquals(
      json,
      """{"gameTitle":null,"layoutFamily":null,"knownPlayerAliases":[],"computerPlayerAliases":[]}""",
    )
  }

  test("encodes a populated OcrJobHints in declared field order") {
    val hints = OcrJobHints(
      gameTitle = Some("桃太郎電鉄ワールド"),
      layoutFamily = Some("world"),
      knownPlayerAliases = List(PlayerAliasHint("member-1", List("ぽんた", "PONTA"))),
      computerPlayerAliases = List("さくま", "サクマ"),
    )

    assertEquals(
      hints.asJson.noSpaces,
      """{"gameTitle":"桃太郎電鉄ワールド","layoutFamily":"world","knownPlayerAliases":[{"memberId":"member-1","aliases":["ぽんた","PONTA"]}],"computerPlayerAliases":["さくま","サクマ"]}""",
    )
  }

  test("round-trips through encoder / decoder") {
    val hints = OcrJobHints(
      gameTitle = Some("桃太郎電鉄ワールド"),
      layoutFamily = Some("world"),
      knownPlayerAliases = List(PlayerAliasHint("member-1", List("ぽんた", "PONTA"))),
      computerPlayerAliases = List("さくま"),
    )
    val parsed = parser.decode[OcrJobHints](hints.asJson.noSpaces)

    assertEquals(parsed, Right(hints))
  }

  test("decodes JSON with null/empty optional fields back to defaults") {
    val parsed = parser.decode[OcrJobHints](
      """{"gameTitle":null,"layoutFamily":null,"knownPlayerAliases":[],"computerPlayerAliases":[]}"""
    )

    assertEquals(parsed, Right(OcrJobHints()))
  }

  test("PlayerAliasHint round-trips") {
    val hint = PlayerAliasHint("member-2", List("alias1"))

    assertEquals(hint.asJson.noSpaces, """{"memberId":"member-2","aliases":["alias1"]}""")
    assertEquals(parser.decode[PlayerAliasHint](hint.asJson.noSpaces), Right(hint))
  }
end OcrHintsCodecSpec
