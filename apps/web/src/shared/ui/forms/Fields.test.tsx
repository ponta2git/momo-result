import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { CheckboxField } from "@/shared/ui/forms/CheckboxField";
import { Fieldset } from "@/shared/ui/forms/Fieldset";
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

  it("keeps required state separate from the field's accessible name", () => {
    render(
      <>
        <TextField label="表示名" required />
        <CheckboxField label="確認済み" required />
      </>,
    );

    expect(screen.getByRole("textbox", { name: "表示名" })).toBeRequired();
    expect(screen.getByRole("checkbox", { name: "確認済み" })).toBeRequired();
  });

  it("associates a group error and keeps disabled controls out of the submitted form", async () => {
    const user = userEvent.setup();
    render(
      <form aria-label="権限設定">
        <p id="permission-help">管理者が設定します。</p>
        <Fieldset
          aria-describedby="permission-help"
          description="必要な権限を選んでください。"
          disabled
          error="権限を変更できません。"
          legend="権限"
        >
          <CheckboxField defaultChecked label="管理画面" name="admin" />
        </Fieldset>
      </form>,
    );
    const group = screen.getByRole("group", { name: "権限" });
    const control = within(group).getByRole("checkbox", { name: "管理画面" });
    expect(group).toHaveAttribute("aria-invalid", "true");
    expect(group).toHaveAccessibleDescription(
      "必要な権限を選んでください。 権限を変更できません。 管理者が設定します。",
    );
    expect(control).toBeDisabled();
    await user.click(control);
    expect(control).toBeChecked();
    expect(new FormData(screen.getByRole("form") as HTMLFormElement).has("admin")).toBe(false);
  });
});
