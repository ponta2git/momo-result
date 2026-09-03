import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SelectField } from "@/shared/ui/forms/SelectField";
import { TextField } from "@/shared/ui/forms/TextField";

describe("form fields", () => {
  it("associates labels, help, and local errors with native controls", () => {
    render(
      <>
        <TextField description="半角数字で入力" error="入力を確認してください" label="試合番号" />
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
  });
});
