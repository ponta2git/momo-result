package momo.api.logging

import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets

import scala.jdk.CollectionConverters.*

import ch.qos.logback.classic.joran.JoranConfigurator
import ch.qos.logback.classic.util.LogbackMDCAdapter
import ch.qos.logback.classic.{Logger, LoggerContext}
import ch.qos.logback.core.OutputStreamAppender
import ch.qos.logback.core.status.Status
import io.circe.parser.parse
import munit.FunSuite

final class LogbackConfigurationSpec extends FunSuite:
  test("the production configuration emits JSON for the default and unrecognized formats"):
    List("", "json", "unrecognized").foreach { format =>
      val output = render(format, "INFO")(_.info("configuration probe"))
      val json = parse(output).fold(error => fail(error.message), identity)
      assertEquals(json.hcursor.get[String]("message"), Right("configuration probe"))
      assertEquals(json.hcursor.get[String]("app"), Right("momo-result-api"))
      assertEquals(json.hcursor.get[String]("level"), Right("INFO"))
      assertEquals(output.linesIterator.size, 1)
    }

  test("the production configuration preserves case-insensitive text selection and log levels"):
    List("text", "TeXt").foreach { format =>
      val output = render(format, "WARN") { logger =>
        logger.info("suppressed probe")
        logger.warn("visible probe")
      }
      assert(output.contains("WARN"))
      assert(output.contains("visible probe"))
      assert(!output.contains("suppressed probe"))
      assertEquals(output.linesIterator.size, 1)
    }

  private def render(format: String, level: String)(write: Logger => Unit): String =
    val context = new LoggerContext()
    val output = new ByteArrayOutputStream()
    try
      context.setMDCAdapter(new LogbackMDCAdapter())
      context.putProperty("MOMO_LOG_FORMAT", format)
      context.putProperty("MOMO_LOG_LEVEL", level)
      val configurator = new JoranConfigurator()
      configurator.setContext(context)
      val configuration = Option(getClass.getResource("/logback.xml"))
        .getOrElse(fail("Production logback.xml resource is missing"))
      configurator.doConfigure(configuration)

      val root = context.getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME)
      val appenders = root.iteratorForAppenders().asScala.toList
      assertEquals(appenders.size, 1)
      appenders.head match
        case appender: OutputStreamAppender[?] =>
          assert(appender.isStarted)
          appender.setOutputStream(output)
        case appender => fail(s"Unexpected production appender: ${appender.getClass.getName}")

      write(root)
      val errors = context.getStatusManager.getCopyOfStatusList.asScala
        .filter(_.getLevel >= Status.ERROR).map(_.getMessage).toList
      assertEquals(errors, List.empty[String])
      output.toString(StandardCharsets.UTF_8)
    finally context.stop()

end LogbackConfigurationSpec
