import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { LinkButton } from "@/shared/ui/actions/LinkButton";

describe("LinkButton", () => {
  it("keeps navigation semantics while presenting an action", () => {
    render(
      <MemoryRouter>
        <LinkButton to="/matches/new">手入力で作成</LinkButton>
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "手入力で作成" })).toHaveAttribute(
      "href",
      "/matches/new",
    );
    expect(screen.queryByRole("button", { name: "手入力で作成" })).not.toBeInTheDocument();
  });
});
