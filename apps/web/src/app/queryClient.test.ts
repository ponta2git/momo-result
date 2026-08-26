// @vitest-environment node
import { describe, expect, it } from "vitest";

import { queryClient } from "@/app/queryClient";

describe("app queryClient", () => {
  it("keeps production cache and error defaults explicit", () => {
    expect(queryClient.getDefaultOptions()).toMatchObject({
      mutations: {
        retry: false,
      },
      queries: {
        retry: 1,
        staleTime: 10_000,
        throwOnError: false,
      },
    });
  });

  it("does not refetch automatically on browser focus or reconnect", () => {
    expect(queryClient.getDefaultOptions().queries).toMatchObject({
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
    });
  });
});
