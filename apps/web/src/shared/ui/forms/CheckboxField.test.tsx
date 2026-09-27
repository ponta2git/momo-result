import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { CheckboxField } from "@/shared/ui/forms/CheckboxField";

describe("CheckboxField", () => {
  it("associates its label, help, and local error with a native checkbox", async () => {
    const user = userEvent.setup();
    render(
      <>
        <p id="permission-context">変更は監査ログに記録されます。</p>
        <CheckboxField
          aria-describedby="permission-context"
          description="管理画面を利用できます。"
          error="権限を確認してください。"
          label="管理者"
        />
      </>,
    );

    const checkbox = screen.getByRole("checkbox", { name: "管理者" });
    expect(checkbox).toHaveAttribute("aria-invalid", "true");
    expect(checkbox).toHaveAccessibleDescription(
      "管理画面を利用できます。 権限を確認してください。 変更は監査ログに記録されます。",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("権限を確認してください。");

    await user.click(checkbox);
    expect(checkbox).toBeChecked();
  });

  it("describes a separate saved status without changing the label or replacing the control", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<CheckboxField label="OCR完了" />);
    const checkbox = screen.getByRole("checkbox", { name: "OCR完了" });
    await user.click(screen.getByText("OCR完了"));
    expect(checkbox).toBeChecked();
    rerender(<CheckboxField label="OCR完了" status="保存済み OFF" />);
    expect(screen.getByRole("checkbox", { name: "OCR完了" })).toBe(checkbox);
    expect(checkbox).toHaveFocus();
    expect(checkbox).toBeChecked();
    expect(checkbox).toHaveAccessibleDescription("保存済み OFF");
    await user.click(screen.getByText("保存済み OFF"));
    expect(checkbox).toBeChecked();
  });
});
