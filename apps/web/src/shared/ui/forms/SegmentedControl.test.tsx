import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { SegmentedControl } from "@/shared/ui/forms/SegmentedControl";

const options = [
  { label: "CSV", value: "csv" },
  { label: "TSV", value: "tsv" },
] as const;

describe("SegmentedControl", () => {
  it("uses one tab stop and native arrow navigation for mutually exclusive modes", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    function Modes() {
      const [value, setValue] = useState("csv");
      return (
        <>
          <SegmentedControl
            label="出力形式"
            options={[
              options[0],
              { label: "利用不可", value: "unavailable", disabled: true },
              options[1],
            ]}
            value={value}
            onValueChange={(next) => {
              setValue(next);
              onValueChange(next);
            }}
          />
          <button type="button">次へ</button>
        </>
      );
    }
    render(<Modes />);

    const csv = screen.getByRole("radio", { name: "CSV" });
    const tsv = screen.getByRole("radio", { name: "TSV" });
    expect(screen.getByRole("group", { name: "出力形式" })).toBeInTheDocument();
    await user.tab();
    expect(csv).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(tsv).toHaveFocus();
    expect(tsv).toBeChecked();
    expect(csv).not.toBeChecked();
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith("tsv");

    await user.click(tsv);
    await user.keyboard(" ");
    expect(onValueChange).toHaveBeenCalledTimes(1);
    await user.tab();
    expect(screen.getByRole("button", { name: "次へ" })).toHaveFocus();
  });

  it("blocks pointer and keyboard changes while disabled", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <SegmentedControl
        disabled
        label="出力形式"
        options={options}
        value="csv"
        onValueChange={onValueChange}
      />,
    );

    const tsv = screen.getByRole("radio", { name: "TSV" });
    expect(tsv).toBeDisabled();
    await user.click(tsv);
    tsv.focus();
    await user.keyboard("{Enter}");
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("isolates the native radio group from another segmented control", async () => {
    const user = userEvent.setup();
    const firstChange = vi.fn();
    const secondChange = vi.fn();
    render(
      <>
        <SegmentedControl
          label="最初の形式"
          options={options}
          value="csv"
          onValueChange={firstChange}
        />
        <SegmentedControl
          label="次の形式"
          options={options}
          value="csv"
          onValueChange={secondChange}
        />
      </>,
    );

    const first = within(screen.getByRole("group", { name: "最初の形式" }));
    const second = within(screen.getByRole("group", { name: "次の形式" }));
    await user.click(second.getByRole("radio", { name: "TSV" }));
    expect(first.getByRole("radio", { name: "CSV" })).toBeChecked();
    expect(secondChange).toHaveBeenCalledExactlyOnceWith("tsv");
    expect(firstChange).not.toHaveBeenCalled();
  });
});
