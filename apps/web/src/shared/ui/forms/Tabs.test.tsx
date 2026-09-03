import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { TabsList, TabsPanel, TabsRoot, TabsTab } from "@/shared/ui/forms/Tabs";

function TabsFixture({ activateOnFocus = false }: { activateOnFocus?: boolean | undefined }) {
  return (
    <TabsRoot defaultValue="first">
      <TabsList activateOnFocus={activateOnFocus} aria-label="表示内容">
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
  it("links mounted panels accessibly and keeps disabled choices unavailable", () => {
    render(<TabsFixture />);

    const first = screen.getByRole("tab", { name: "最初" });
    const second = screen.getByRole("tab", { name: "次" });
    const disabled = screen.getByRole("tab", { name: "無効" });
    const firstPanel = screen.getByRole("tabpanel", { name: "最初" });
    const secondPanel = document.getElementById(second.getAttribute("aria-controls") ?? "");

    expect(disabled).toHaveAttribute("aria-disabled", "true");
    expect(first).toHaveAttribute("aria-controls", firstPanel.id);
    expect(first).toHaveClass("min-h-11", "pointer-fine:min-h-9");
    expect(first).not.toHaveClass("sm:min-h-9");
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
});
