// @vitest-environment node
import { describe, expect, it } from "vitest";

import { invalidateAdminAccountCaches } from "@/features/adminAccounts/adminAccountCache";
import { adminAccountsQueryKeys } from "@/features/adminAccounts/queryKeys";
import { authMeQueryKey } from "@/shared/auth/authQueries";
import { createTestQueryClient } from "@/test/queryClient";

describe("admin account cache contract", () => {
  it("invalidates the admin account list and current auth state", async () => {
    const queryClient = createTestQueryClient();
    const authQueryKey = [...authMeQueryKey, "session"] as const;
    queryClient.setQueryData(adminAccountsQueryKeys.all(), { items: [] });
    queryClient.setQueryData(authQueryKey, { accountId: "account-1", isAdmin: true });

    await invalidateAdminAccountCaches(queryClient);

    expect(queryClient.getQueryState(adminAccountsQueryKeys.all())?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(authQueryKey)?.isInvalidated).toBe(true);
  });
});
