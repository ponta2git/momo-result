import { screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

/** Select by stable domain identity while exercising the visible popup and its option. */
export async function selectOption(user: UserEvent, trigger: HTMLElement, value: string) {
  if (trigger.getAttribute("aria-expanded") !== "true") await user.click(trigger);
  const list = await screen.findByRole("listbox");
  const option = within(list)
    .getAllByRole("option")
    .find((item) => item.dataset["value"] === value);
  if (!option) throw new Error(`Select option not found: ${value}`);
  await user.click(option);
}
