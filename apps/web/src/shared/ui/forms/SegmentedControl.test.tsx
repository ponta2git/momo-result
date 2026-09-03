import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SegmentedControl } from "@/shared/ui/forms/SegmentedControl";

const options = [
  { label: "CSV", value: "csv" },
  { label: "TSV", value: "tsv" },
];

describe("SegmentedControl", () => {
  it("selects an option from the keyboard", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <SegmentedControl
        label="出力形式"
        options={options}
        value="csv"
        onValueChange={onValueChange}
      />,
    );

    const tsv = screen.getByRole("button", { name: "TSV" });
    expect(tsv).toHaveClass("min-h-11", "focus-visible:-outline-offset-3", "pointer-fine:min-h-9");
    expect(tsv).not.toHaveClass("sm:min-h-9");
    tsv.focus();
    await user.keyboard("{Enter}");
    expect(onValueChange).toHaveBeenCalledWith("tsv");
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

    const tsv = screen.getByRole("button", { name: "TSV" });
    expect(tsv).toBeDisabled();
    await user.click(tsv);
    tsv.focus();
    await user.keyboard("{Enter}");
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
