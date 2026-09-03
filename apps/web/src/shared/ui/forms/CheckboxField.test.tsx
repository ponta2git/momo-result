import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { CheckboxField } from "@/shared/ui/forms/CheckboxField";

describe("CheckboxField", () => {
  it("associates its label, help, and local error with a native checkbox", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const ref = createRef<HTMLInputElement>();
    render(
      <>
        <p id="permission-context">変更は監査ログに記録されます。</p>
        <CheckboxField
          ref={ref}
          aria-describedby="permission-context"
          description="管理画面を利用できます。"
          error="権限を確認してください。"
          label="管理者"
          onChange={onChange}
        />
      </>,
    );

    const checkbox = screen.getByRole("checkbox", { name: "管理者" });
    expect(ref.current).toBe(checkbox);
    expect(checkbox).toHaveAttribute("aria-invalid", "true");
    expect(checkbox.getAttribute("aria-describedby")?.split(" ")).toHaveLength(3);
    expect(checkbox).toHaveAccessibleDescription(
      "管理画面を利用できます。 権限を確認してください。 変更は監査ログに記録されます。",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("権限を確認してください。");

    const control = checkbox.closest("[data-field-control]");
    const support = screen.getByRole("alert").closest("[data-field-support]");
    expect(control).toHaveClass("gap-2");
    expect(support).toHaveClass("mt-1", "gap-1", "pl-8");
    expect(support).toContainElement(screen.getByText("管理画面を利用できます。"));

    await user.click(checkbox);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("keeps disabled state on the native control", () => {
    render(<CheckboxField disabled label="ログインを許可" />);

    expect(screen.getByRole("checkbox", { name: "ログインを許可" })).toBeDisabled();
  });
});
