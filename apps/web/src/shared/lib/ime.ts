type KeyLike = { isComposing?: unknown; keyCode?: unknown };

/**
 * True while an input method is composing text. Safari can deliver the confirming Enter with
 * `isComposing` already false but keyCode 229, so both are checked before treating a key as a
 * command such as commit or cancel. Accepts a React event (through `nativeEvent`) or a DOM event.
 */
export function isImeComposing(event: { nativeEvent: unknown } | KeyLike): boolean {
  const native = "nativeEvent" in event ? event.nativeEvent : event;
  if (native === null || typeof native !== "object") return false;
  const key = native as KeyLike;
  return key.isComposing === true || key.keyCode === 229;
}
