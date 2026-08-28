package momo.api.endpoints

import io.circe.Codec
import sttp.model.StatusCode
import sttp.tapir.{Schema, Validator}

import momo.api.errors.AppError

final case class ProblemDetails(
    `type`: String,
    title: String,
    status: Int,
    detail: String,
    code: String,
) derives Codec.AsObject

object ProblemDetails:
  /**
   * HTTP presentation of an application error.
   *
   * Keeping the status and retry metadata with the body prevents callers from depending on the
   * positional shape of Tapir's composite output.
   */
  final case class ProblemResponse(
      status: StatusCode,
      retryAfter: Option[String],
      body: ProblemDetails,
  )

  private val ProblemCodes = List(
    "BAD_REQUEST",
    "UNAUTHORIZED",
    "FORBIDDEN",
    "NOT_FOUND",
    "VALIDATION_FAILED",
    "UNSUPPORTED_MEDIA_TYPE",
    "PAYLOAD_TOO_LARGE",
    "CONFLICT",
    "MATCH_NOTE_VERSION_CONFLICT",
    "IDEMPOTENCY_IN_PROGRESS",
    "IDEMPOTENCY_PAYLOAD_MISMATCH",
    "TOO_MANY_REQUESTS",
    "SERVICE_UNAVAILABLE",
    "ANALYSIS_ARTIFACT_EXPIRED",
    "ANALYSIS_SCOPE_NOT_FOUND",
    "ANALYSIS_SCOPE_NOT_IN_ARTIFACT",
    "ANALYSIS_READ_BUSY",
    "ANALYSIS_STATE_UNAVAILABLE",
    "ANALYSIS_NO_ELIGIBLE_TITLES",
    "ANALYSIS_CLIENT_UPGRADE_REQUIRED",
    "DEPENDENCY_FAILED",
    "INTERNAL_ERROR",
  )

  given Schema[ProblemDetails] = Schema.derived[ProblemDetails]
    .modify(_.code)(_.validate(Validator.enumeration(ProblemCodes, v => Some(v))))

  def from(error: AppError): ProblemResponse =
    val status = statusOf(error)
    ProblemResponse(
      status = status,
      retryAfter = retryAfter(error),
      body = ProblemDetails(
        `type` = s"https://momo-result.local/problems/${error.code.toLowerCase}",
        title = error.title,
        status = status.code,
        detail = publicDetail(error),
        code = error.code,
      ),
    )

  private def retryAfter(error: AppError): Option[String] = error match
    case busy: AppError.AnalysisReadBusy => Some(busy.retryAfterSeconds.toString)
    case _ => None

  private def publicDetail(error: AppError): String = error match
    case _: AppError.BadRequest | _: AppError.ValidationFailed =>
      "入力内容を確認してください。"
    case _: AppError.Unauthorized => "ログインが必要です。再度ログインしてください。"
    case _: AppError.Forbidden => "この操作を行う権限がありません。"
    case _: AppError.NotFound => "指定されたデータが見つかりませんでした。"
    case _: AppError.UnsupportedMediaType =>
      "対応していないファイル形式です。PNG、JPEG、WebPの画像を選択してください。"
    case _: AppError.PayloadTooLarge => "送信内容が大きすぎます。入力内容を減らしてください。"
    case _: AppError.Conflict =>
      "保存済みの状態が変わっています。内容を確認して、もう一度実行してください。"
    case _: AppError.MatchNoteVersionConflict =>
      "試合メモが別の利用者に更新されました。最新の内容を確認してください。"
    case _: AppError.IdempotencyInProgress =>
      "同じ操作を処理中です。少し待ってから、同じ内容で再実行してください。"
    case _: AppError.IdempotencyPayloadMismatch =>
      "送信内容が変わっています。現在の内容で再実行してください。"
    case _: AppError.TooManyRequests =>
      "操作が集中しています。少し待ってから、もう一度実行してください。"
    case _: AppError.ServiceUnavailable | _: AppError.DependencyFailed =>
      "現在処理を完了できません。少し待ってから、もう一度実行してください。"
    case _: AppError.AnalysisArtifactExpired =>
      "この分析結果は利用できなくなりました。最新の結果を読み込んでください。"
    case _: AppError.AnalysisScopeNotFound => "指定された分析対象が見つかりませんでした。"
    case _: AppError.AnalysisScopeNotInArtifact =>
      "指定された条件の分析結果は、現在の結果に含まれていません。"
    case _: AppError.AnalysisReadBusy =>
      "分析結果を読み込めません。少し待ってから、もう一度実行してください。"
    case _: AppError.AnalysisStateUnavailable =>
      "分析状態を読み込めません。少し待ってから、もう一度実行してください。"
    case _: AppError.AnalysisNoEligibleTitles => "分析できる作品がありません。"
    case _: AppError.AnalysisClientUpgradeRequired =>
      "最新の分析結果を使うため、ページを再読み込みしてください。"
    case _: AppError.Internal => "予期しないエラーが発生しました。もう一度お試しください。"

  private def statusOf(error: AppError): StatusCode = error match
    case _: AppError.BadRequest => StatusCode.BadRequest
    case _: AppError.Unauthorized => StatusCode.Unauthorized
    case _: AppError.Forbidden => StatusCode.Forbidden
    case _: AppError.NotFound => StatusCode.NotFound
    case _: AppError.ValidationFailed => StatusCode.UnprocessableEntity
    case _: AppError.UnsupportedMediaType => StatusCode.UnsupportedMediaType
    case _: AppError.PayloadTooLarge => StatusCode.PayloadTooLarge
    case _: AppError.Conflict => StatusCode.Conflict
    case _: AppError.MatchNoteVersionConflict => StatusCode.Conflict
    case _: AppError.IdempotencyInProgress => StatusCode.Conflict
    case _: AppError.IdempotencyPayloadMismatch => StatusCode.Conflict
    case _: AppError.TooManyRequests => StatusCode.TooManyRequests
    case _: AppError.ServiceUnavailable => StatusCode.ServiceUnavailable
    case _: AppError.AnalysisArtifactExpired => StatusCode.Gone
    case _: AppError.AnalysisScopeNotFound => StatusCode.NotFound
    case _: AppError.AnalysisScopeNotInArtifact => StatusCode.Conflict
    case _: AppError.AnalysisReadBusy => StatusCode.ServiceUnavailable
    case _: AppError.AnalysisStateUnavailable => StatusCode.ServiceUnavailable
    case _: AppError.AnalysisNoEligibleTitles => StatusCode.Conflict
    case _: AppError.AnalysisClientUpgradeRequired => StatusCode.UpgradeRequired
    case _: AppError.DependencyFailed => StatusCode.ServiceUnavailable
    case _: AppError.Internal => StatusCode.InternalServerError
