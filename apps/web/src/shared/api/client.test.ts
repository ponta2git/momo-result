import { describe, expect, it, vi } from "vitest";
import { apiRequest } from "@/shared/api/client";

function requireInit(init: RequestInit | undefined): RequestInit {
  if (!init) {
    throw new Error("Expected fetch init");
  }
  return init;
}

describe("apiRequest", () => {
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

    vi.unstubAllGlobals();
  });

  it("does not set multipart Content-Type manually", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/api/uploads/images", { method: "POST", formData: new FormData() });

    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit]>;
    const init = requireInit(calls[0]?.[1]);
    const headers = init.headers as Headers;
    expect(headers.has("Content-Type")).toBe(false);

    vi.unstubAllGlobals();
  });
});
