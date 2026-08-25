import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { Button } from "@/shared/ui/actions/Button";
import { createDeferred } from "@/test/deferred";

function PendingForm({ action }: { action: () => Promise<void> }) {
  const [completed, setCompleted] = useState(false);
  return (
    <form
      action={async () => {
        await action();
        setCompleted(true);
      }}
    >
      <Button pendingLabel="保存中" type="submit">
        保存
      </Button>
      {completed ? <p>保存しました</p> : null}
    </form>
  );
}

describe("Button", () => {
  it("defaults to a non-submitting button", () => {
    render(<Button>閉じる</Button>);

    expect(screen.getByRole("button", { name: "閉じる" })).toHaveAttribute("type", "button");
  });

  it("inherits pending state from its parent form for submit actions", async () => {
    const user = userEvent.setup();
    const deferred = createDeferred<void>();
    render(<PendingForm action={() => deferred.promise} />);

    await user.click(screen.getByRole("button", { name: "保存" }));

    const pendingButton = screen.getByRole("button", { name: "保存中" });
    expect(pendingButton).toBeDisabled();
    expect(pendingButton).toHaveAttribute("aria-busy", "true");

    deferred.resolve();
    expect(await screen.findByText("保存しました")).toBeInTheDocument();
  });

  it("uses an explicit pending value outside a form", () => {
    render(
      <Button pending pendingLabel="更新中">
        更新
      </Button>,
    );

    expect(screen.getByRole("button", { name: "更新中" })).toBeDisabled();
  });
});
