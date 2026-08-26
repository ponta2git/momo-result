import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { TabsList, TabsPanel, TabsRoot, TabsTab } from "@/shared/ui/forms/Tabs";

function TabsFixture({
  activateOnFocus = false,
  variant = "filled",
  wrap,
}: {
  activateOnFocus?: boolean | undefined;
  variant?: "filled" | "underline" | undefined;
  wrap?: boolean | undefined;
}) {
  return (
    <TabsRoot defaultValue="first">
      <TabsList
        activateOnFocus={activateOnFocus}
        aria-label="表示内容"
        variant={variant}
        wrap={wrap}
      >
        <TabsTab value="first">最初</TabsTab>
        <TabsTab value="second">次</TabsTab>
        <TabsTab disabled value="disabled">
          無効
        </TabsTab>
      </TabsList>
      <TabsPanel keepMounted value="first">
        最初の内容
      </TabsPanel>
      <TabsPanel keepMounted value="second">
        次の内容
      </TabsPanel>
      <TabsPanel keepMounted value="disabled">
        無効な内容
      </TabsPanel>
    </TabsRoot>
  );
}

describe("Tabs", () => {
  it("applies the filled tab grammar and links mounted panels accessibly", () => {
    render(<TabsFixture />);

    const list = screen.getByRole("tablist", { name: "表示内容" });
    const first = screen.getByRole("tab", { name: "最初" });
    const second = screen.getByRole("tab", { name: "次" });
    const disabled = screen.getByRole("tab", { name: "無効" });
    const firstPanel = screen.getByRole("tabpanel", { name: "最初" });
    const secondPanel = document.getElementById(second.getAttribute("aria-controls") ?? "");

    expect(list).toHaveClass("flex-wrap", "gap-2");
    expect(first).toHaveClass(
      "min-h-11",
      "whitespace-nowrap",
      "focus-visible:outline-2",
      "bg-[var(--color-surface-selected)]",
      "text-[var(--color-text-primary)]",
    );
    expect(second).toHaveClass(
      "text-[var(--color-text-secondary)]",
      "hover:bg-[var(--color-surface-subtle)]",
    );
    expect(disabled).toHaveAttribute("aria-disabled", "true");
    expect(disabled).toHaveClass("cursor-not-allowed", "opacity-60");
    expect(disabled).not.toHaveClass("hover:bg-[var(--color-surface-subtle)]");
    expect(first).toHaveAttribute("aria-controls", firstPanel.id);
    expect(firstPanel).toHaveAttribute("aria-labelledby", first.id);
    expect(secondPanel).not.toBeNull();
    expect(secondPanel).toHaveAttribute("hidden");
    expect(secondPanel).toHaveAttribute("inert");
  });

  it("activates on arrow-key focus when requested and retains mounted panels", async () => {
    const user = userEvent.setup();
    render(<TabsFixture activateOnFocus />);

    const first = screen.getByRole("tab", { name: "最初" });
    const second = screen.getByRole("tab", { name: "次" });
    await user.tab();
    expect(first).toHaveFocus();

    await user.keyboard("{ArrowRight}");

    expect(second).toHaveFocus();
    expect(second).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "次" })).toHaveTextContent("次の内容");
    expect(document.getElementById(first.getAttribute("aria-controls") ?? "")).toHaveAttribute(
      "hidden",
    );
  });

  it("defaults an underline variant to a non-wrapping local scroll owner", () => {
    render(<TabsFixture variant="underline" />);

    const list = screen.getByRole("tablist", { name: "表示内容" });
    const first = screen.getByRole("tab", { name: "最初" });
    const second = screen.getByRole("tab", { name: "次" });

    expect(list).toHaveClass(
      "flex-nowrap",
      "overflow-x-auto",
      "border-b",
      "border-[var(--color-border)]",
    );
    expect(first).toHaveClass(
      "border-b-2",
      "border-[var(--color-action)]",
      "text-[var(--color-text-primary)]",
    );
    expect(second).toHaveClass("border-transparent", "text-[var(--color-text-secondary)]");
  });

  it("allows a caller to override the variant-specific wrapping default", () => {
    render(<TabsFixture variant="underline" wrap />);

    expect(screen.getByRole("tablist", { name: "表示内容" })).toHaveClass("flex-wrap");
  });
});
