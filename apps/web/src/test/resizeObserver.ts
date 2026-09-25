/** jsdom has no layout engine. Tests explicitly deliver measured geometry when it matters. */
const observers = new Set<TestResizeObserver>();

class TestResizeObserver implements ResizeObserver {
  private readonly targets = new Set<Element>();
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    observers.add(this);
  }

  observe(target: Element) {
    this.targets.add(target);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
    observers.delete(this);
  }

  deliver(target: Element) {
    if (!this.targets.has(target)) return;
    const contentRect = target.getBoundingClientRect();
    const size = { blockSize: contentRect.height, inlineSize: contentRect.width };
    this.callback(
      [
        {
          borderBoxSize: [size],
          contentBoxSize: [size],
          contentRect,
          devicePixelContentBoxSize: [size],
          target,
        },
      ],
      this,
    );
  }
}

export function resetResizeObservers() {
  observers.clear();
  return TestResizeObserver;
}

/** Call inside act after setting the target's geometry. This is not browser layout evidence. */
export function notifyResize(target: Element) {
  for (const observer of observers) observer.deliver(target);
}
