import { useState } from "react";

/**
 * Keeps an editable copy of a committed value (for example one owned by the URL). A new committed
 * value replaces the copy without remounting the input, so focus stays where the reader left it.
 */
export function useCommittedDraft<T>(committed: T, signature: (value: T) => string) {
  const [state, setState] = useState({ committedKey: signature(committed), draft: committed });
  const committedKey = signature(committed);
  if (state.committedKey !== committedKey) {
    setState({ committedKey, draft: committed });
  }
  const draft = state.committedKey === committedKey ? state.draft : committed;
  return [draft, (next: T) => setState({ committedKey, draft: next })] as const;
}
