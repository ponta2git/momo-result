import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { getCsrfToken, setCsrfToken } from "@/shared/api/csrfTokenStore";
import { DevUserPicker } from "@/shared/auth/DevUserPicker";
import { setDevUser, testDevUserStorageKey } from "@/test/auth";
import { createTestQueryClient } from "@/test/queryClient";

describe("DevUserPicker principal transition", () => {
  it("clears cached and tab-local state before activating another account", async () => {
    const queryClient = createTestQueryClient();
    setDevUser("account_eu");
    setCsrfToken("previous-principal-csrf");
    window.sessionStorage.setItem(
      "momoresult.matchWorkspaceDraft.v2.account_eu.review.session-1",
      "private draft",
    );
    window.sessionStorage.setItem("momoresult.masterHandoff.legacy-handoff", "legacy handoff");
    queryClient.setQueryData(["private-resource"], { owner: "account_eu" });

    render(
      <QueryClientProvider client={queryClient}>
        <DevUserPicker force />
      </QueryClientProvider>,
    );

    await userEvent.selectOptions(screen.getByLabelText("操作用アカウント"), "account_ponta");

    await waitFor(() =>
      expect(window.localStorage.getItem(testDevUserStorageKey)).toBe("account_ponta"),
    );
    expect(queryClient.getQueryData(["private-resource"])).toBeUndefined();
    expect(window.sessionStorage.length).toBe(0);
    expect(getCsrfToken()).toBeUndefined();
  });
});
