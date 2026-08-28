import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Disclosure } from "@/shared/ui/data/Collapsible";

describe("Disclosure", () => {
  it("exposes one accessible trigger and reveals its content on request", async () => {
    const user = userEvent.setup();
    render(
      <Disclosure summary="詳細条件">
        <p>追加条件</p>
      </Disclosure>,
    );

    const trigger = screen.getByRole("button", { name: "詳細条件" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("追加条件")).not.toBeInTheDocument();

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("追加条件")).toBeInTheDocument();
  });
});
