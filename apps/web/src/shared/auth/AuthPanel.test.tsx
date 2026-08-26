import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthPanel } from "@/shared/auth/AuthPanel";

describe("AuthPanel", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("leaves authenticated-session teardown to the global account control", () => {
    vi.stubEnv("DEV", false);

    render(
      <AuthPanel
        auth={{
          accountId: "account_ponta",
          csrfToken: "session-csrf",
          displayName: "ぽんた",
          isAdmin: true,
          memberId: "member_ponta",
        }}
        embedded
      />,
    );

    expect(screen.getByText("ログイン中")).toBeInTheDocument();
    expect(screen.getByText("ぽんた")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ログアウト" })).not.toBeInTheDocument();
  });
});
