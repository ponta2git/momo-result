package momo.api.http

import cats.effect.IO
import io.circe.{Decoder, Json}
import munit.Assertions.*
import org.http4s.circe.*
import org.http4s.{Response, Status}
import org.typelevel.ci.CIString

object HttpAssertions:
  def assertProblem(
      response: Response[IO],
      expectedStatus: Status,
      expectedCode: String,
      privateDetail: String,
  ): IO[Unit] = response.as[Json].map { body =>
    assertProblemFields(response, body, expectedStatus, expectedCode)
    val detail = body.hcursor.get[String]("detail")
    assertEquals(detail, Right(expectedPublicDetail(expectedCode)))
    assert(
      !detail.exists(_.contains(privateDetail)),
      s"private detail was exposed: ${body.noSpaces}"
    )
  }

  def assertProblemSanitizedDetail(
      response: Response[IO],
      expectedStatus: Status,
      expectedCode: String,
      privateDetail: String,
  ): IO[Unit] = response.as[Json].map { body =>
    assertProblemFields(response, body, expectedStatus, expectedCode)
    val detail = body.hcursor.get[String]("detail")
    assertEquals(detail, Right(expectedPublicDetail(expectedCode)))
    assert(
      !detail.exists(_.contains(privateDetail)),
      s"private detail was exposed: ${body.noSpaces}"
    )
  }

  private def expectedPublicDetail(code: String): String = code match
    case "BAD_REQUEST" | "VALIDATION_FAILED" => "入力内容を確認してください。"
    case "UNAUTHORIZED" => "ログインが必要です。再度ログインしてください。"
    case "FORBIDDEN" => "この操作を行う権限がありません。"
    case "NOT_FOUND" => "指定されたデータが見つかりませんでした。"
    case "UNSUPPORTED_MEDIA_TYPE" =>
      "対応していないファイル形式です。PNG、JPEG、WebPの画像を選択してください。"
    case "PAYLOAD_TOO_LARGE" => "送信内容が大きすぎます。入力内容を減らしてください。"
    case "CONFLICT" =>
      "保存済みの状態が変わっています。内容を確認して、もう一度実行してください。"
    case "IDEMPOTENCY_IN_PROGRESS" =>
      "同じ操作を処理中です。少し待ってから、同じ内容で再実行してください。"
    case "IDEMPOTENCY_PAYLOAD_MISMATCH" =>
      "送信内容が変わっています。現在の内容で再実行してください。"
    case "TOO_MANY_REQUESTS" =>
      "操作が集中しています。少し待ってから、もう一度実行してください。"
    case "SERVICE_UNAVAILABLE" | "DEPENDENCY_FAILED" =>
      "現在処理を完了できません。少し待ってから、もう一度実行してください。"
    case "ANALYSIS_ARTIFACT_EXPIRED" =>
      "この分析結果は利用できなくなりました。最新の結果を読み込んでください。"
    case "ANALYSIS_SCOPE_NOT_FOUND" => "指定された分析対象が見つかりませんでした。"
    case "ANALYSIS_SCOPE_NOT_IN_ARTIFACT" =>
      "指定された条件の分析結果は、現在の結果に含まれていません。"
    case "ANALYSIS_READ_BUSY" =>
      "分析結果を読み込めません。少し待ってから、もう一度実行してください。"
    case "ANALYSIS_STATE_UNAVAILABLE" =>
      "分析状態を読み込めません。少し待ってから、もう一度実行してください。"
    case "ANALYSIS_NO_ELIGIBLE_TITLES" => "分析できる作品がありません。"
    case "ANALYSIS_CLIENT_UPGRADE_REQUIRED" =>
      "最新の分析結果を使うため、ページを再読み込みしてください。"
    case "INTERNAL_ERROR" => "予期しないエラーが発生しました。もう一度お試しください。"
    case other => fail(s"missing public detail assertion for problem code: $other")

  private def assertProblemFields(
      response: Response[IO],
      body: Json,
      expectedStatus: Status,
      expectedCode: String,
  ): Unit =
    assertEquals(response.status, expectedStatus)
    assertEquals(body.hcursor.get[Int]("status"), Right(expectedStatus.code))
    assertEquals(body.hcursor.get[String]("code"), Right(expectedCode))

  def jsonField[A: Decoder](body: Json, field: String): A = body.hcursor.get[A](field).fold(
    error => fail(s"expected JSON field '$field': ${error.getMessage}; body=${body.noSpaces}"),
    identity,
  )

  def optionalHeaderValue(response: Response[IO], name: CIString): Option[String] = response.headers
    .get(name).map(_.head.value)

  def headerValue(response: Response[IO], name: CIString): String =
    optionalHeaderValue(response, name)
      .getOrElse(fail(s"expected header '${name.toString}' on response status=${response.status}"))
