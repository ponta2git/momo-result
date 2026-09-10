package momo.api.domain

import cats.syntax.all.*

import momo.api.errors.AppError

enum ResultNotificationKind(val wire: String) derives CanEqual:
  case OcrCompleted extends ResultNotificationKind("ocr_completed")
  case AnalysisCompleted extends ResultNotificationKind("analysis_completed")

final case class NotificationGeneration private (value: Long) derives CanEqual:
  def next: Option[NotificationGeneration] =
    Option.when(value < Long.MaxValue)(NotificationGeneration(value + 1))

object NotificationGeneration:
  val initial: NotificationGeneration = NotificationGeneration(0)

  def fromLong(value: Long): Either[String, NotificationGeneration] =
    Either.cond(value >= 0, NotificationGeneration(value), "generation must be nonnegative")

  def fromString(value: String): Either[String, NotificationGeneration] =
    Option.when(value.matches("0|[1-9][0-9]{0,18}"))(value).flatMap(_.toLongOption)
      .toRight("generation must be a nonnegative bigint decimal string").flatMap(fromLong)

final case class NotificationSetting(enabled: Boolean, generation: NotificationGeneration)
    derives CanEqual

final case class NotificationSettings(
    ocrCompleted: NotificationSetting,
    analysisCompleted: NotificationSetting,
) derives CanEqual:
  def apply(kind: ResultNotificationKind): NotificationSetting = kind match
    case ResultNotificationKind.OcrCompleted => ocrCompleted
    case ResultNotificationKind.AnalysisCompleted => analysisCompleted

final case class NotificationSettingUpdate(
    enabled: Boolean,
    expectedGeneration: NotificationGeneration,
)

final case class NotificationSettingsUpdate(
    ocrCompleted: NotificationSettingUpdate,
    analysisCompleted: NotificationSettingUpdate,
):
  def apply(kind: ResultNotificationKind): NotificationSettingUpdate = kind match
    case ResultNotificationKind.OcrCompleted => ocrCompleted
    case ResultNotificationKind.AnalysisCompleted => analysisCompleted

final case class NotificationSettingsChange(
    settings: NotificationSettings,
    changedKinds: List[ResultNotificationKind],
):
  def disabledKinds: List[ResultNotificationKind] = changedKinds.filterNot(settings(_).enabled)

object NotificationSettings:
  val initial: NotificationSettings = NotificationSettings(
    NotificationSetting(true, NotificationGeneration.initial),
    NotificationSetting(true, NotificationGeneration.initial),
  )

  /** Evaluate under the writer's lock, before either setting or any notification is changed. */
  def change(
      current: NotificationSettings,
      requested: NotificationSettingsUpdate,
  ): Either[AppError, NotificationSettingsChange] =
    val kinds = ResultNotificationKind.values.toList
    if kinds.exists(kind => current(kind).generation != requested(kind).expectedGeneration) then
      Left(AppError.NotificationSettingsVersionConflict())
    else
      val changed = kinds.filter(kind => current(kind).enabled != requested(kind).enabled)
      def next(kind: ResultNotificationKind): Either[AppError, NotificationSetting] =
        if !changed.contains(kind) then Right(current(kind))
        else current(kind).generation.next
          .toRight(AppError.Internal("Notification settings generation is exhausted."))
          .map(NotificationSetting(requested(kind).enabled, _))
      (next(ResultNotificationKind.OcrCompleted), next(ResultNotificationKind.AnalysisCompleted))
        .mapN((ocr, analysis) => NotificationSettingsChange(NotificationSettings(ocr, analysis), changed))
