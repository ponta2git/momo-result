import { describe, expect, it } from "vitest";

import { queryClient } from "@/app/queryClient";

describe("app queryClient", () => {
  it("keeps production server-state defaults explicit", () => {
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
});
