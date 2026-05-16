// @vitest-environment node
import { describe, expect, it } from "vitest";

import { invalidateAdminAccountCaches } from "@/features/adminAccounts/adminAccountCache";
import { adminAccountsQueryKeys } from "@/features/adminAccounts/queryKeys";
import { createTestQueryClient } from "@/test/queryClient";

describe("admin account cache contract", () => {
  it("invalidates the admin account list", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(adminAccountsQueryKeys.all(), { items: [] });

    await invalidateAdminAccountCaches(queryClient);

    expect(queryClient.getQueryState(adminAccountsQueryKeys.all())?.isInvalidated).toBe(true);
  });
});
