import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { InputControl } from "@/shared/ui/forms/Control";

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
