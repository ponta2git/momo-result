import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { InputControl, TextareaControl } from "@/shared/ui/forms/Control";

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

  it("preserves native values, read-only copy access, form submission and reset", async () => {
    const user = userEvent.setup();
    const ref = createRef<HTMLTextAreaElement>();
    const submitted = vi.fn();
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitted(Object.fromEntries(new FormData(event.currentTarget)));
        }}
      >
        <InputControl aria-label="試合番号" defaultValue="12" name="matchNumber" required />
        <TextareaControl ref={ref} aria-label="試合メモ" defaultValue="保存前のメモ" name="note" />
        <InputControl aria-label="識別子" name="identifier" readOnly value="match-12" />
        <button type="submit">保存</button>
        <button type="reset">初期化</button>
      </form>,
    );

    const note = screen.getByRole("textbox", { name: "試合メモ" });
    expect(ref.current).toBe(note);
    await user.clear(note);
    await user.type(note, "変更後のメモ");
    const identifier = screen.getByRole("textbox", { name: "識別子" });
    await user.click(identifier);
    await user.keyboard("replacement");
    expect(identifier).toHaveFocus();
    expect(identifier).toHaveValue("match-12");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(submitted).toHaveBeenCalledExactlyOnceWith({
      identifier: "match-12",
      matchNumber: "12",
      note: "変更後のメモ",
    });

    await user.click(screen.getByRole("button", { name: "初期化" }));
    expect(note).toHaveValue("保存前のメモ");
  });
});
