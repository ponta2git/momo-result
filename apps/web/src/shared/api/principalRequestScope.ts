import type { QueryClient } from "@tanstack/react-query";

const principalScopes = new WeakMap<QueryClient, AbortController>();

/** Captured commands stop being eligible as soon as the principal begins changing. */
export function principalRequestSignal(queryClient: QueryClient): AbortSignal {
  let scope = principalScopes.get(queryClient);
  if (!scope) {
    scope = new AbortController();
    principalScopes.set(queryClient, scope);
  }
  return scope.signal;
}

export function clearPrincipalRequestScope(queryClient: QueryClient): void {
  const previousScope = principalScopes.get(queryClient);
  principalScopes.delete(queryClient);
  previousScope?.abort();
}
