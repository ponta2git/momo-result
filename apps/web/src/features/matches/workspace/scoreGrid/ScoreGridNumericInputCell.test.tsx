import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { vi } from "vitest";

import { NumericInputCell } from "@/features/matches/workspace/scoreGrid/ScoreGridNumericInputCell";

const inputControlRender = vi.hoisted(() => vi.fn());

vi.mock("@/shared/ui/forms/Control", async () => {
  const { forwardRef } = await import("react");

  const InputControl = forwardRef<
    HTMLInputElement,
    ComponentProps<"input"> & {
      density?: string | undefined;
      invalid?: boolean | undefined;
      textAlign?: string | undefined;
      tone?: string | undefined;
    }
  >(function InputControl(
    { density: _density, invalid, textAlign: _textAlign, tone: _tone, ...props },
    ref,
  ) {
    inputControlRender();
    return <input {...props} ref={ref} aria-invalid={invalid || undefined} />;
  });

  return { InputControl };
});

const onCommit = vi.fn();

function NumericInputCellHarness({
  error = false,
  parentVersion,
  value,
}: {
  error?: boolean;
  parentVersion: number;
  value: number;
}) {
  return (
    <div data-parent-version={parentVersion}>
      <NumericInputCell
        allowSign={false}
        ariaLabel="ぽんた 順位"
        cellId="players.0.rank"
        controlWidth="short"
        error={error}
        row={0}
        value={value}
        onCommit={onCommit}
      />
    </div>
  );
}

describe("NumericInputCell memo boundary", () => {
  it("skips unrelated parent renders and updates for relevant value and state changes", () => {
    const { rerender } = render(<NumericInputCellHarness parentVersion={0} value={1} />);

    expect(inputControlRender).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox", { name: "ぽんた 順位" })).toHaveValue("1");

    rerender(<NumericInputCellHarness parentVersion={1} value={1} />);

    expect(inputControlRender).toHaveBeenCalledTimes(1);

    rerender(<NumericInputCellHarness parentVersion={1} value={2} />);

    expect(inputControlRender).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("textbox", { name: "ぽんた 順位" })).toHaveValue("2");

    rerender(<NumericInputCellHarness error parentVersion={1} value={2} />);

    expect(inputControlRender).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("textbox", { name: "ぽんた 順位" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });
});
