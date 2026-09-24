import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { useAdjacentNavigationFocus } from "@/shared/navigation/useAdjacentNavigationFocus";
import { PageHeader } from "@/shared/ui/layout/PageHeader";
import { AdjacentNavigation } from "@/shared/ui/navigation/AdjacentNavigation";

const previous = { label: "前の記録", description: "最初の記録です" };
const next = { label: "後の記録", description: "2026年9月24日 第2試合", href: "/records/two" };

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="現在のURL">{location.pathname}</output>;
}

function FocusPage({ ready }: { ready: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const ref = useAdjacentNavigationFocus(ready);
  return (
    <>
      <button type="button" onClick={() => navigate(-1)}>
        履歴を戻る
      </button>
      <PageHeader title={location.pathname} titleRef={ref} />
      <AdjacentNavigation label="記録の前後移動" next={next} previous={previous} />
    </>
  );
}

function focusView(ready: boolean) {
  return (
    <MemoryRouter initialEntries={["/records/one"]}>
      <Routes>
        <Route element={<FocusPage ready={ready} />} path="/records/:id" />
      </Routes>
    </MemoryRouter>
  );
}

describe("AdjacentNavigation", () => {
  it("keeps a paused destination focused without exposing or following its stale href", async () => {
    const user = userEvent.setup();
    const view = (disabled: boolean) => (
      <MemoryRouter initialEntries={["/records/one"]}>
        <AdjacentNavigation
          disabled={disabled}
          label="記録の前後移動"
          next={next}
          previous={previous}
        />
        <LocationProbe />
      </MemoryRouter>
    );
    const { rerender } = render(view(false));
    expect(screen.queryByRole("link", { name: /前の記録/u })).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: /後の記録/u });
    link.focus();
    rerender(view(true));
    expect(link).toHaveFocus();
    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(link).not.toHaveAttribute("href");
    await user.keyboard("{Enter}");
    await user.click(link);
    expect(screen.getByLabelText("現在のURL")).toHaveTextContent("/records/one");
    rerender(view(false));
    await user.click(link);
    expect(screen.getByLabelText("現在のURL")).toHaveTextContent("/records/two");
  });

  it("focuses a ready adjacent destination once and leaves browser history navigation alone", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/records/one"]}>
        <Routes>
          <Route element={<FocusPage ready />} path="/records/:id" />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "/records/one" })).not.toHaveFocus();
    await user.click(screen.getByRole("link", { name: /後の記録/u }));
    expect(screen.getByRole("heading", { name: "/records/two" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "履歴を戻る" }));
    expect(screen.getByRole("heading", { name: "/records/one" })).not.toHaveFocus();
  });

  it("does not steal focus when the user acts while the destination is loading", async () => {
    const user = userEvent.setup();
    const { rerender } = render(focusView(false));
    await user.click(screen.getByRole("link", { name: /後の記録/u }));
    await user.tab();
    rerender(focusView(true));
    expect(screen.getByRole("heading", { name: "/records/two" })).not.toHaveFocus();
  });
});
