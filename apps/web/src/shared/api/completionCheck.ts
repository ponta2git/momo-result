import { useCallback, useState } from "react";

/** How often a screen rechecks accepted work while it shows that work as waiting. */
export const completionCheckIntervalMs = 2_000;

/**
 * Accepted work normally ends within this; a wait that outlasts it is treated as stuck, and only
 * the screen's own update or a reopen checks it again.
 */
export const completionCheckLimitMs = 5 * 60_000;

type CheckedQuery<TData> = { readonly state: { data: TData | undefined; status: string } };

const waitStarts = new WeakMap<object, { readonly wait: string; readonly startedAt: number }>();

/**
 * Query options for the bounded completion check that the Web rule's Server State allows: while a
 * screen shows accepted work (an OCR read, an analysis run) as waiting in place of its result, the
 * read that shows it is rechecked until the wait ends. `waitOf` names that wait from the data, or
 * returns undefined when nothing waits. A failed read stops the check until a later read succeeds,
 * the same wait stops at the time limit, a hidden page skips the rechecks, and leaving the screen
 * ends them with its observer.
 */
export function completionCheckOptions<TData>(waitOf: (data: TData) => string | undefined) {
  return {
    refetchInterval: (query: CheckedQuery<TData>) => {
      const { data, status } = query.state;
      const wait = data === undefined ? undefined : waitOf(data);
      if (wait === undefined || status === "error") return false;
      const now = Date.now();
      let started = waitStarts.get(query);
      if (started?.wait !== wait) {
        started = { wait, startedAt: now };
        waitStarts.set(query, started);
      }
      return now - started.startedAt < completionCheckLimitMs ? completionCheckIntervalMs : false;
    },
    refetchIntervalInBackground: false,
  } as const;
}

/**
 * Rechecks during a completion check are not the user's update. A screen that keeps an update
 * control shows it pending only for the refresh the user asked for.
 */
export function useUserRefresh(refetch: () => Promise<unknown>) {
  const [pending, setPending] = useState(false);
  const run = useCallback(() => {
    setPending(true);
    void refetch().finally(() => setPending(false));
  }, [refetch]);
  return { pending, run } as const;
}
