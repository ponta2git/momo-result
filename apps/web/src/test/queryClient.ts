import { QueryClient } from "@tanstack/react-query";

import { queryClient as appQueryClient } from "@/app/queryClient";

const clients = new Set<QueryClient>();

export function createTestQueryClient(): QueryClient {
  const defaults = appQueryClient.getDefaultOptions();
  const client = new QueryClient({
    defaultOptions: {
      ...defaults,
      queries: {
        ...defaults.queries,
        // Keep production policy; only make failure and cache lifetimes deterministic in tests.
        retry: false,
        staleTime: 0,
        gcTime: Number.POSITIVE_INFINITY,
      },
    },
  });
  clients.add(client);
  return client;
}

/** Close cache owners after their consumers unmount, including queries started outside React. */
export function resetTestQueryClients(): void {
  for (const client of clients) client.clear();
  clients.clear();
}
