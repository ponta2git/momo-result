import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CheckboxField } from "@/shared/ui/forms/CheckboxField";

describe("CheckboxField", () => {
  it("associates its label, help, and local error with a native checkbox", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <CheckboxField
        description="管理画面を利用できます。"
        error="権限を確認してください。"
        label="管理者"
        onChange={onChange}
      />,
    );

    const checkbox = screen.getByRole("checkbox", { name: "管理者" });
    expect(checkbox).toHaveClass("size-4");
    expect(checkbox).toHaveAttribute("aria-invalid", "true");
    expect(checkbox.getAttribute("aria-describedby")?.split(" ")).toHaveLength(2);
    expect(screen.getByRole("alert")).toHaveTextContent("権限を確認してください。");

    await user.click(checkbox);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("keeps disabled state on the native control", () => {
    render(<CheckboxField disabled label="ログインを許可" />);

    expect(screen.getByRole("checkbox", { name: "ログインを許可" })).toBeDisabled();
  });
});
