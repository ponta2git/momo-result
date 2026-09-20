import { useState } from "react";

/** Keeps a settled problem and its recovery control visible during a same-scope retry.
 * This is presentation memory only: query state still owns data, permissions and retries.
 */
export function useRetryNotice<T extends boolean | string | undefined>(
  value: T,
  pending: boolean,
  scope: string = "",
): T {
  const [settled, setSettled] = useState({ scope, value });
  if (settled.scope !== scope || (!pending && settled.value !== value)) {
    setSettled({ scope, value });
  }
  return pending && settled.scope === scope ? settled.value : value;
}
