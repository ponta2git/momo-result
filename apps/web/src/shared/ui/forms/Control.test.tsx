import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { InputControl, SelectControl } from "@/shared/ui/forms/Control";

describe("InputControl", () => {
  it("keeps the native input contract while owning invalid and disabled presentation", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const ref = createRef<HTMLInputElement>();

    render(
      <InputControl
        ref={ref}
        aria-describedby="amount-help"
        aria-label="金額"
        defaultValue="120"
        disabled
        invalid
        onChange={onChange}
      />,
    );

    const input = screen.getByRole("textbox", { name: "金額" });
    expect(ref.current).toBe(input);
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "amount-help");

    await user.type(input, "3");
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("SelectControl", () => {
  it("preserves native option selection and omits invalid ARIA when valid", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <SelectControl aria-label="プレー順" defaultValue="1" onChange={onChange}>
        <option value="1">1</option>
        <option value="2">2</option>
      </SelectControl>,
    );

    const select = screen.getByRole("combobox", { name: "プレー順" });
    expect(select).not.toHaveAttribute("aria-invalid");

    await user.selectOptions(select, "2");
    expect(select).toHaveValue("2");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("keeps disabled and invalid state on the native select", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <SelectControl aria-label="無効な選択" defaultValue="1" disabled invalid onChange={onChange}>
        <option value="1">1</option>
        <option value="2">2</option>
      </SelectControl>,
    );

    const select = screen.getByRole("combobox", { name: "無効な選択" });
    expect(select).toBeDisabled();
    expect(select).toHaveAttribute("aria-invalid", "true");

    await user.selectOptions(select, "2");
    expect(select).toHaveValue("1");
    expect(onChange).not.toHaveBeenCalled();
  });
});
