import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiDownload, apiRequest, getAuthMe } from "@/shared/api/client";
import { fetchCallsOf } from "@/test/doubles/dom";

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
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/api/example");
    await apiRequest("/api/example", { method: "POST", body: { ok: true } });

    const calls = fetchCallsOf(fetchMock);
    const getInit = requireInit(calls[0]?.[1]);
    const postInit = requireInit(calls[1]?.[1]);
    const getHeaders = getInit.headers as Headers;
    const postHeaders = postInit.headers as Headers;

    expect(getHeaders.get("X-Dev-User")).toBe("account_ponta");
    expect(getHeaders.has("X-CSRF-Token")).toBe(false);
    expect(postHeaders.get("X-Dev-User")).toBe("account_ponta");
    expect(postHeaders.get("X-CSRF-Token")).toBe("dev");
    expect(postHeaders.get("Content-Type")).toBe("application/json");
  });

  it("uses csrf token returned from auth state for non-dev mutations", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          accountId: "account_ponta",
          displayName: "ぽんた",
          isAdmin: true,
          memberId: "member_ponta",
          csrfToken: "csrf-1",
        }),
      )
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await getAuthMe();
    await apiRequest("/api/example", { method: "POST", body: { ok: true } });

    const calls = fetchCallsOf(fetchMock);
    const postInit = requireInit(calls[1]?.[1]);
    const postHeaders = postInit.headers as Headers;

    expect(postHeaders.has("X-Dev-User")).toBe(false);
    expect(postHeaders.get("X-CSRF-Token")).toBe("csrf-1");
  });

  it("does not set multipart Content-Type manually", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/api/uploads/images", { method: "POST", formData: new FormData() });

    const calls = fetchCallsOf(fetchMock);
    const init = requireInit(calls[0]?.[1]);
    const headers = init.headers as Headers;
    expect(headers.has("Content-Type")).toBe(false);
  });

  it("adds idempotency keys only to JSON mutation endpoints that require them", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const idempotentRequests = [
      { method: "POST", path: "/api/held-events" },
      { method: "POST", path: "/api/match-drafts" },
      { method: "PATCH", path: "/api/match-drafts/draft-1" },
      { method: "POST", path: "/api/matches" },
      { method: "POST", path: "/api/ocr-jobs" },
      { method: "POST", path: "/api/game-titles" },
      { method: "POST", path: "/api/map-masters" },
      { method: "POST", path: "/api/season-masters" },
      { method: "POST", path: "/api/admin/login-accounts" },
    ] as const;

    for (const request of idempotentRequests) {
      await apiRequest(request.path, { method: request.method, body: { ok: true } });
    }
    await apiRequest("/api/uploads/images", { method: "POST", formData: new FormData() });
    await apiRequest("/api/auth/logout", { method: "POST" });

    const calls = fetchCallsOf(fetchMock);
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    for (const [index] of idempotentRequests.entries()) {
      const headers = requireInit(calls[index]?.[1]).headers as Headers;
      expect(headers.get("Idempotency-Key")).toMatch(uuidPattern);
    }
    const uploadHeaders = requireInit(calls[idempotentRequests.length]?.[1]).headers as Headers;
    const logoutHeaders = requireInit(calls[idempotentRequests.length + 1]?.[1]).headers as Headers;
    expect(uploadHeaders.has("Idempotency-Key")).toBe(false);
    expect(logoutHeaders.has("Idempotency-Key")).toBe(false);
  });

  it("uses caller-provided idempotency key for manual retries", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/api/matches", {
      method: "POST",
      body: { matchNoInEvent: 1 },
      idempotencyKey: "submit-key-1",
    });

    const calls = fetchCallsOf(fetchMock);
    const headers = requireInit(calls[0]?.[1]).headers as Headers;
    expect(headers.get("Idempotency-Key")).toBe("submit-key-1");
  });

  it("downloads non-JSON files with dev auth and filename metadata", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
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

    const calls = fetchCallsOf(fetchMock);
    const init = requireInit(calls[0]?.[1]);
    const headers = init.headers as Headers;
    expect(headers.get("X-Dev-User")).toBe("account_ponta");
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
