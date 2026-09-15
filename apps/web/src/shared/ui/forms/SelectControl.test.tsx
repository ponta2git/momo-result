import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "@/shared/ui/actions/Button";
import { Dialog } from "@/shared/ui/feedback/Dialog";
import { SelectControl } from "@/shared/ui/forms/SelectControl";

const options = [
  { label: "すべて", value: "" },
  { label: "春", value: "spring" },
  { label: "夏", value: "summer", disabled: true },
  { label: "秋", value: "autumn" },
];

describe("SelectControl", () => {
  it("retains closed-field typeahead without opening or selecting a disabled match", async () => {
    const user = userEvent.setup();
    render(
      <SelectControl
        aria-label="対象"
        defaultValue="spring"
        options={[
          { value: "spring", label: "Spring" },
          { value: "blocked", label: "Autumn unavailable", disabled: true },
          { value: "autumn", label: "Autumn" },
        ]}
      />,
    );
    await user.tab();
    await user.keyboard("a");
    expect(screen.getByRole("combobox")).toHaveTextContent("Autumn");
    expect(screen.getByRole("combobox")).not.toHaveTextContent("unavailable");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("separates navigation, cancellation and commitment, retaining form values and reset", async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    render(
      <form aria-label="設定">
        <label htmlFor="season">シーズン</label>
        <SelectControl
          id="season"
          ref={ref}
          name="season"
          defaultValue=""
          options={options}
          onValueChange={changed}
        />
        <input aria-label="次の項目" />
      </form>,
    );
    const trigger = screen.getByRole("combobox", { name: "シーズン" });
    const form = screen.getByRole("form", { name: "設定" }) as HTMLFormElement;
    expect(ref.current).toBe(trigger);
    expect(trigger).toHaveTextContent("すべて");
    await user.tab();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(new FormData(form).get("season")).toBe("");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(changed).not.toHaveBeenCalled();
    await user.click(trigger);
    await screen.findByRole("listbox");
    await user.click(await screen.findByRole("option", { name: "春" }));
    expect(new FormData(form).get("season")).toBe("spring");
    expect(trigger).toHaveTextContent("春");
    expect(changed).toHaveBeenCalledExactlyOnceWith("spring");
    await user.click(trigger);
    await screen.findByRole("listbox");
    await user.click(await screen.findByRole("option", { name: "春" }));
    expect(changed).toHaveBeenCalledTimes(1);
    await user.click(trigger);
    await screen.findByRole("listbox");
    await user.keyboard("{ArrowDown}{Tab}");
    await waitFor(() => expect(screen.getByRole("textbox", { name: "次の項目" })).toHaveFocus());
    expect(new FormData(form).get("season")).toBe("spring");
    await act(async () => form.reset());
    expect(trigger).toHaveTextContent("すべて");
    expect(new FormData(form).get("season")).toBe("");
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("keeps a select inside its dialog interaction and form, and dismisses one layer at a time", async () => {
    const user = userEvent.setup();
    render(
      <Dialog title="設定を変更" trigger={<Button>設定</Button>}>
        <form aria-label="設定フォーム">
          <SelectControl
            aria-label="シーズン"
            defaultValue="spring"
            name="season"
            options={options}
          />
          <Button type="submit">保存</Button>
        </form>
      </Dialog>,
    );
    await user.click(screen.getByRole("button", { name: "設定" }));
    const trigger = screen.getByRole("combobox", { name: "シーズン" });
    await user.click(trigger);
    await screen.findByRole("listbox");
    await user.click(await screen.findByRole("option", { name: "秋" }));
    expect(screen.getByRole("dialog", { name: "設定を変更" })).toBeInTheDocument();
    expect(new FormData(screen.getByRole("form") as HTMLFormElement).get("season")).toBe("autumn");
    await user.click(trigger);
    await screen.findByRole("listbox");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps unavailable controls inert and commits controlled values without treating an ID as a label", async () => {
    const user = userEvent.setup();
    function Controlled() {
      const [value, setValue] = useState("spring");
      return (
        <SelectControl aria-label="対象" value={value} options={options} onValueChange={setValue} />
      );
    }
    const { rerender } = render(<Controlled />);
    await user.click(screen.getByRole("combobox"));
    expect(await screen.findByRole("option", { name: "夏" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await user.click(await screen.findByRole("option", { name: "秋" }));
    expect(screen.getByRole("combobox")).toHaveTextContent("秋");
    rerender(
      <SelectControl aria-label="対象" value="missing-id" options={options} invalid disabled />,
    );
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("combobox")).not.toHaveTextContent("missing-id");
  });

  it("discards an open popup when its field becomes unavailable", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <SelectControl aria-label="対象" value="spring" options={options} />,
    );
    await user.click(screen.getByRole("combobox"));
    await screen.findByRole("listbox");
    rerender(<SelectControl aria-label="対象" value="spring" options={options} disabled />);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    rerender(<SelectControl aria-label="対象" value="spring" options={options} />);
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    expect(screen.getByRole("combobox")).toHaveTextContent("春");
  });
});
