package momo.api.adapters.postgres

/** Normalizes the bounded identity/attendance CHECK vocabulary without losing boolean grouping. */
private[postgres] object PostgresSchemaExpression:
  private val Literal = "'(?:''|[^'])*'".r
  private val Operators =
    List("OR", "AND").map(operator => operator -> ("\\b" + operator + "\\b").r)

  def normalize(value: String): String =
    // SQL literals are data: casts, spacing and parentheses inside them must remain exact.
    val literals =
      Literal.findAllMatchIn(value).map(matched => matched.start -> matched.matched).toList
    val masked = Literal.replaceAllIn(value, matched => token(matched.start))
    literals.foldLeft(normalizeBoolean(masked.replaceAll("::text\\b", ""))) {
      case (normalized, (offset, literal)) => normalized.replace(token(offset), literal)
    }

  private def token(offset: Int): String = s"\uE000$offset\uE001"

  private def nesting(value: String): Vector[Int] =
    value.scanLeft(0) { (depth, character) =>
      if character == '(' then depth + 1
      else if character == ')' then depth - 1
      else depth
    }.toVector

  private def normalizeBoolean(value: String): String =
    val text = value.trim
    val depths = nesting(text)
    if text.startsWith("(") && text.endsWith(")") &&
      depths.drop(1).dropRight(1).forall(_ > 0)
    then normalizeBoolean(text.substring(1, text.length - 1))
    else
      val split = Operators.iterator.map { case (operator, pattern) =>
        operator -> pattern.findAllMatchIn(text).map(_.start)
          .filter(index => depths(index) == 0).toList
      }.find(_._2.nonEmpty)
      split.fold(
        text.replaceAll("\\bIN\\s*\\(([^()]+)\\)", "= ANY (ARRAY[$1])")
          .filterNot(character =>
            character.isWhitespace || character == '(' || character == ')' || character == '"'
          )
      ) { case (operator, positions) =>
        val starts = 0 :: positions.map(_ + operator.length)
        val ends = positions :+ text.length
        val operands = starts.zip(ends).map { case (start, end) =>
          normalizeBoolean(text.substring(start, end))
        }
        operator + operands.mkString("(", ",", ")")
      }
