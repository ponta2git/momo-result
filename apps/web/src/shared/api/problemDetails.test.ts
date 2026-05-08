// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

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
      title: "Network error",
      detail: "fetch failed",
    });
  });

  it("formats idempotency conflicts as an internal reload message", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(
      formatApiError(
        {
          kind: "api",
          status: 409,
          title: "Conflict",
          detail: "same Idempotency-Key was reused with a different payload",
          code: "IDEMPOTENCY_CONFLICT",
        },
        "fallback",
      ),
    ).toBe("内部エラーが発生しました。ページを再読み込みしてください。");
    expect(warn).toHaveBeenCalledWith(
      "Idempotency-Key conflict",
      expect.objectContaining({ code: "IDEMPOTENCY_CONFLICT", status: 409 }),
    );

    warn.mockRestore();
  });
});
