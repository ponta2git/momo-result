import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CircleHelp } from "lucide-react";
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

  it("keeps derived native state authoritative over unsafely forwarded attributes", () => {
    const unsafeNativeProps = { "aria-busy": "false" } as const;
    render(
      // @ts-expect-error -- verifies the public API rejects this override while exercising the runtime guard for untyped callers.
      <Button {...unsafeNativeProps} pending pendingLabel="送信中" type="submit">
        送信
      </Button>,
    );

    const button = screen.getByRole("button", { name: "送信中" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("type", "submit");
  });

  it("treats a supplied icon as decorative and keeps one accessible name", () => {
    render(<Button icon={<CircleHelp aria-label="補足アイコン" />}>詳細を見る</Button>);

    expect(screen.getByRole("button", { name: "詳細を見る" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /補足アイコン/u })).not.toBeInTheDocument();
  });
});
