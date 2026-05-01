import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiDownload, apiRequest, getAuthMe } from "@/shared/api/client";

function requireInit(init: RequestInit | undefined): RequestInit {
  if (!init) {
    throw new Error("Expected fetch init");
  }
  return init;
}

describe("apiRequest", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds dev auth and csrf headers only when appropriate", async () => {
    window.localStorage.setItem("momoresult.devUser", "ponta");
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/api/example");
    await apiRequest("/api/example", { method: "POST", body: { ok: true } });

    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit]>;
    const getInit = requireInit(calls[0]?.[1]);
    const postInit = requireInit(calls[1]?.[1]);
    const getHeaders = getInit.headers as Headers;
    const postHeaders = postInit.headers as Headers;

    expect(getHeaders.get("X-Dev-User")).toBe("ponta");
    expect(getHeaders.has("X-CSRF-Token")).toBe(false);
    expect(postHeaders.get("X-Dev-User")).toBe("ponta");
    expect(postHeaders.get("X-CSRF-Token")).toBe("dev");
    expect(postHeaders.get("Content-Type")).toBe("application/json");
  });

  it("uses csrf token returned from auth state for non-dev mutations", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ memberId: "member_ponta", displayName: "ぽんた", csrfToken: "csrf-1" }),
      )
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await getAuthMe();
    await apiRequest("/api/example", { method: "POST", body: { ok: true } });

    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit]>;
    const postInit = requireInit(calls[1]?.[1]);
    const postHeaders = postInit.headers as Headers;

    expect(postHeaders.has("X-Dev-User")).toBe(false);
    expect(postHeaders.get("X-CSRF-Token")).toBe("csrf-1");
  });

  it("does not set multipart Content-Type manually", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/api/uploads/images", { method: "POST", formData: new FormData() });

    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit]>;
    const init = requireInit(calls[0]?.[1]);
    const headers = init.headers as Headers;
    expect(headers.has("Content-Type")).toBe(false);
  });

  it("downloads non-JSON files with dev auth and filename metadata", async () => {
    window.localStorage.setItem("momoresult.devUser", "ponta");
    const fetchMock = vi.fn(
      async () =>
        new Response("a,b\n", {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": 'attachment; filename="momo-results-all.csv"',
          },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiDownload("/api/exports/matches?format=csv");

    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit]>;
    const init = requireInit(calls[0]?.[1]);
    const headers = init.headers as Headers;
    expect(headers.get("X-Dev-User")).toBe("ponta");
    expect(result.fileName).toBe("momo-results-all.csv");
    expect(result.contentType).toContain("text/csv");
    await expect(result.blob.text()).resolves.toBe("a,b\n");
  });

  it("normalizes problem responses during file download", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        {
          type: "about:blank",
          title: "Validation Failed",
          status: 422,
          detail: "format must be one of: csv, tsv.",
          code: "VALIDATION_FAILED",
        },
        { status: 422 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiDownload("/api/exports/matches?format=x")).rejects.toMatchObject({
      status: 422,
      detail: "format must be one of: csv, tsv.",
      code: "VALIDATION_FAILED",
    });
  });
});
