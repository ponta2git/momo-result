import { useActionState, useOptimistic, useRef } from "react";

import type { AuthorizationLease, AuthorizationOperations } from "@/shared/auth/authorization";
import type { ManagementPermission } from "@/shared/auth/permissions";

type ActionAuthorization = Pick<AuthorizationOperations, "begin" | "canCommit" | "isCurrent">;
type AuthorizedState<State> = { value: State; lease: AuthorizationLease | undefined };
type ActionRequest<State> = {
  formData: FormData;
  lease: AuthorizationLease;
  run: (previous: State, formData: FormData, lease: AuthorizationLease) => Promise<State>;
};

/** Own each submitted form before React's Action queue starts its asynchronous work. */
export function useAuthorizedAction<State>(
  authorization: ActionAuthorization,
  permission: ManagementPermission,
  run: ActionRequest<State>["run"],
  initialState: State,
) {
  const active = useRef<AuthorizationLease | undefined>(undefined);
  const [pendingLease, setPendingLease] = useOptimistic<AuthorizationLease | undefined>(undefined);
  const [result, enqueue] = useActionState<AuthorizedState<State>, ActionRequest<State>>(
    async (previous, request) => {
      try {
        if (!authorization.canCommit(request.lease)) return previous;
        const previousValue =
          previous.lease && authorization.isCurrent(previous.lease) ? previous.value : initialState;
        return {
          value: await request.run(previousValue, request.formData, request.lease),
          lease: request.lease,
        };
      } finally {
        // An obsolete Action may finish while a new permission generation waits in the queue.
        if (active.current === request.lease) active.current = undefined;
      }
    },
    { value: initialState, lease: undefined },
  );
  const dispatch = (formData: FormData) => {
    if (active.current && authorization.isCurrent(active.current)) return;
    const lease = authorization.begin(permission);
    if (!lease) return;
    active.current = lease;
    // This update remains immediate even when the caller dispatches inside startTransition.
    setPendingLease(lease);
    enqueue({ formData, lease, run });
  };

  return [
    result.lease && authorization.isCurrent(result.lease) ? result.value : initialState,
    dispatch,
    Boolean(pendingLease && authorization.isCurrent(pendingLease)),
  ] as const;
}
