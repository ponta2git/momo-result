export const globalNavigationId = "global-navigation";

/** Reveal a page target without placing its label under the sticky navigation. */
export function revealPageElement(element: HTMLElement, block: ScrollLogicalPosition = "nearest") {
  if (element.getClientRects().length === 0) return;
  element.scrollIntoView({ behavior: "instant", block, inline: "nearest" });
  const navigation = document.getElementById(globalNavigationId);
  const visibleTop = Math.max(0, navigation?.getBoundingClientRect().bottom ?? 0) + 8;
  const targetTop = element.getBoundingClientRect().top;
  if (targetTop < visibleTop) {
    window.scrollBy({ behavior: "instant", top: targetTop - visibleTop });
  }
}
