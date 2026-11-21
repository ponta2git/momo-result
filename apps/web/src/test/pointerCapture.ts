/**
 * jsdom has no pointer capture. Components that capture a pointer (Base UI Slider) get an explicit
 * per-element record instead, so a pointer sequence can be driven in component tests. This is not
 * browser evidence of dragging; drag and touch behavior is checked in a browser.
 */
const captured = new WeakMap<Element, Set<number>>();

export function installPointerCapture() {
  if ("setPointerCapture" in Element.prototype) return;
  Object.assign(Element.prototype, {
    setPointerCapture(this: Element, pointerId: number) {
      const ids = captured.get(this) ?? new Set<number>();
      ids.add(pointerId);
      captured.set(this, ids);
    },
    hasPointerCapture(this: Element, pointerId: number) {
      return captured.get(this)?.has(pointerId) ?? false;
    },
    releasePointerCapture(this: Element, pointerId: number) {
      captured.get(this)?.delete(pointerId);
    },
  });
}
