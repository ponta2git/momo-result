// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  formatApiError,
  normalizeApiErrorResponse,
  normalizeUnknownApiError,
} from "@/shared/api/problemDetails";

describe("problemDetails", () => {
  it("normalizes ProblemDetails JSON", async () => {
    const error = await normalizeApiErrorResponse(
      Response.json(
        {
          type: "about:blank",
          title: "Forbidden",
          status: 403,
          detail: "not allowed",
          code: "FORBIDDEN",
        },
        { status: 403 },
      ),
    );

    expect(error).toMatchObject({
      status: 403,
      title: "Forbidden",
      detail: "not allowed",
      code: "FORBIDDEN",
    });
  });

  it("normalizes text/plain errors", async () => {
    const error = await normalizeApiErrorResponse(
      new Response("Invalid value for: body", {
        status: 400,
        headers: { "content-type": "text/plain" },
      }),
    );

    expect(error).toMatchObject({
      status: 400,
      title: "HTTP 400",
      detail: "Invalid value for: body",
    });
  });

  it("normalizes network failures", () => {
    expect(normalizeUnknownApiError(new Error("fetch failed"))).toMatchObject({
      title: "通信に失敗しました",
      detail: "fetch failed",
    });
  });

  it("formats idempotency in-progress conflicts as a retryable processing message", async () => {
    const error = await normalizeApiErrorResponse(
      Response.json(
        {
          type: "about:blank",
          title: "Conflict",
          status: 409,
          detail: "Idempotency-Key is already processing. Retry later.",
          code: "CONFLICT",
        },
        { status: 409 },
      ),
    );
    expect(formatApiError(error, "fallback")).toBe(
      "同じ操作を処理中です。しばらく待ってから、同じ内容でもう一度実行してください。",
    );
  });

  it("formats payload mismatch idempotency conflicts as a changed-input message", async () => {
    const error = await normalizeApiErrorResponse(
      Response.json(
        {
          type: "about:blank",
          title: "Conflict",
          status: 409,
          detail: "Idempotency-Key was reused with a different request payload.",
          code: "CONFLICT",
        },
        { status: 409 },
      ),
    );

    expect(formatApiError(error, "fallback")).toBe(
      "送信内容が変更されています。現在の内容でもう一度実行してください。",
    );
  });

  it("uses machine-readable idempotency codes when backend provides them", async () => {
    const error = await normalizeApiErrorResponse(
      Response.json(
        {
          type: "about:blank",
          title: "Conflict",
          status: 409,
          detail: "retry later",
          code: "IDEMPOTENCY_IN_PROGRESS",
        },
        { status: 409 },
      ),
    );

    expect(error.category).toBe("idempotency_in_progress");
  });

  it("formats payload-too-large as a validation message", async () => {
    const error = await normalizeApiErrorResponse(
      Response.json(
        {
          type: "about:blank",
          title: "Payload Too Large",
          status: 413,
          detail: "Request body is too large.",
          code: "PAYLOAD_TOO_LARGE",
        },
        { status: 413 },
      ),
    );

    expect(formatApiError(error, "fallback")).toBe(
      "送信内容が大きすぎます。入力内容を減らすか、画像ファイルは画像アップロードから送信してください。",
    );
  });
});
