package momo.api.domain

import java.util.Locale

/** Code-owned reading layouts. Legacy spellings are resolved without changing saved payloads. */
enum OcrLayoutFamily(val wire: String) derives CanEqual:
  case Momotetsu2 extends OcrLayoutFamily("momotetsu_2")
  case World extends OcrLayoutFamily("world")
  case Reiwa extends OcrLayoutFamily("reiwa")

object OcrLayoutFamily:
  private val EdgeWhitespace = "^[ \\t\\r\\n\\f\\x0B]+|[ \\t\\r\\n\\f\\x0B]+$".r

  def fromLegacy(value: String): Option[OcrLayoutFamily] =
    EdgeWhitespace.replaceAllIn(value, "").toLowerCase(Locale.ROOT) match
      case "momotetsu_2" | "momotetsu2" | "2" => Some(OcrLayoutFamily.Momotetsu2)
      case "world" | "momotetsu_world" | "default" => Some(OcrLayoutFamily.World)
      case "reiwa" | "momotetsu_reiwa" => Some(OcrLayoutFamily.Reiwa)
      case _ => None
