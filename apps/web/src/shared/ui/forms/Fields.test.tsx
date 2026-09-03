import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Fieldset } from "@/shared/ui/forms/Fieldset";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { TextField } from "@/shared/ui/forms/TextField";

describe("form fields", () => {
  it("associates labels, help, and local errors with native controls", () => {
    render(
      <>
        <TextField
          description="半角数字で入力"
          error="入力を確認してください"
          label="試合番号"
          layout="subgrid"
        />
        <SelectField
          error="選択してください"
          label="作品"
          options={[{ label: "未選択", value: "" }]}
        />
      </>,
    );

    const input = screen.getByLabelText("試合番号");
    const select = screen.getByLabelText("作品");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("半角数字で入力 入力を確認してください");
    expect(select).toHaveAttribute("aria-invalid", "true");
    expect(select).toHaveAccessibleDescription("選択してください");
    expect(screen.getAllByRole("alert")).toHaveLength(2);

    const field = input.closest("[data-field-root]");
    const fieldLabel = field?.querySelector("[data-field-label]");
    const fieldControl = field?.querySelector("[data-field-control]");
    const fieldSupport = field?.querySelector("[data-field-support]");
    expect(field).toHaveClass("md:grid-rows-subgrid", "md:gap-y-0");
    expect(Array.from(field?.children ?? [])).toEqual([fieldLabel, fieldControl, fieldSupport]);
    expect(fieldLabel).toHaveClass("mb-2");
    expect(fieldControl).toContainElement(input);
    expect(fieldSupport).toHaveClass("mt-1", "gap-1");
    expect(fieldSupport).toContainElement(screen.getByText("半角数字で入力"));
    expect(fieldSupport).toContainElement(screen.getByText("入力を確認してください"));

    const selectField = select.closest("[data-field-root]");
    expect(Array.from(selectField?.children ?? [])).toHaveLength(3);
    expect(selectField?.querySelector("[data-field-support]")).toHaveClass("empty:hidden");
  });

  it("uses the same label, control, and support spacing for grouped fields", () => {
    render(
      <Fieldset description="複数選択できます。" error="一つ以上選択してください。" legend="権限">
        <label>
          <input type="checkbox" />
          管理者
        </label>
      </Fieldset>,
    );

    const fieldset = screen.getByRole("group", { name: "権限" });
    const label = fieldset.querySelector("[data-field-label]");
    const control = fieldset.querySelector(":scope > [data-field-control]");
    const support = fieldset.querySelector(":scope > [data-field-support]");
    expect(label).toBeInTheDocument();
    expect(control).toHaveClass("mt-2");
    expect(support).toHaveClass("mt-1", "gap-1");
    expect(fieldset).toHaveAccessibleDescription("複数選択できます。 一つ以上選択してください。");
  });
});
