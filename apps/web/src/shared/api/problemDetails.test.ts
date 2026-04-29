import { describe, expect, it } from "vitest";
import { normalizeApiErrorResponse, normalizeUnknownApiError } from "@/shared/api/problemDetails";

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
});
