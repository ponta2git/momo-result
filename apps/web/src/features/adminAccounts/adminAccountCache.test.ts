// @vitest-environment node
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { invalidateAdminAccountCaches } from "@/features/adminAccounts/adminAccountCache";
import { adminAccountsQueryKeys } from "@/features/adminAccounts/queryKeys";

describe("admin account cache contract", () => {
  it("invalidates the admin account list", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(adminAccountsQueryKeys.all(), { items: [] });

    await invalidateAdminAccountCaches(queryClient);

    expect(queryClient.getQueryState(adminAccountsQueryKeys.all())?.isInvalidated).toBe(true);
  });
});
