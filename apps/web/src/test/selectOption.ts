import { act, screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

/** Select by stable domain identity while exercising the visible popup and its option. */
export async function selectOption(user: UserEvent, trigger: HTMLElement, value: string) {
  if (trigger.getAttribute("aria-expanded") !== "true") {
    await user.click(trigger);
    await act(async () => undefined);
  }
  const list = await screen.findByRole("listbox");
  const option = within(list)
    .getAllByRole("option")
    .find((item) => item.dataset["value"] === value);
  if (!option) throw new Error(`Select option not found: ${value}`);
  // A selection may start an async Action (e.g. optimistic URL navigation). Flush its
  // React work before the next interaction; user-event's event wrapper uses sync act.
  await user.click(option);
  await act(async () => undefined);
}
