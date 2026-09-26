package momo.api.logging

import ch.qos.logback.core.boolex.PropertyConditionBase

/** Select the existing case-insensitive text format without evaluating configuration as code. */
final class TextLogFormatCondition extends PropertyConditionBase:
  override def evaluate(): Boolean = property("MOMO_LOG_FORMAT").equalsIgnoreCase("text")
