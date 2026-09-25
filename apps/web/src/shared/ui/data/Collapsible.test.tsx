import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Disclosure } from "@/shared/ui/data/Collapsible";

describe("Disclosure", () => {
  it("keeps mounted inputs out of keyboard navigation while closed and preserves their values", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Disclosure keepMounted summary="詳細条件">
          <label>
            条件名
            <input />
          </label>
        </Disclosure>
        <button type="button">次の操作</button>
      </>,
    );
    const trigger = screen.getByRole("button", { name: "詳細条件" });
    const input = screen.getByLabelText("条件名");
    expect(input).not.toBeVisible();
    await user.tab();
    expect(trigger).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "次の操作" })).toHaveFocus();

    await user.click(trigger);
    expect(document.getElementById(trigger.getAttribute("aria-controls")!)).toContainElement(input);
    await user.type(input, "入力した条件");
    await user.click(trigger);
    expect(input).not.toBeVisible();
    await user.keyboard("{Enter}");
    expect(input).toBeVisible();
    expect(input).toHaveValue("入力した条件");
  });

  it("lets the owner control open state and blocks requests when disabled", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    function Controlled({ disabled }: { disabled: boolean }) {
      const [open, setOpen] = useState(false);
      return (
        <Disclosure
          disabled={disabled}
          onOpenChange={(next) => {
            onOpenChange(next);
            setOpen(next);
          }}
          open={open}
          summary="詳細条件"
        >
          追加条件
        </Disclosure>
      );
    }
    const { rerender } = render(<Controlled disabled />);
    const trigger = screen.getByRole("button", { name: "詳細条件" });
    expect(trigger).toHaveAttribute("aria-disabled", "true");
    await user.click(trigger);
    trigger.focus();
    await user.keyboard("{Enter} ");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    rerender(<Controlled disabled={false} />);
    trigger.focus();
    await user.keyboard(" ");
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

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
