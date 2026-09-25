import { QueryClient } from "@tanstack/react-query";

const clients = new Set<QueryClient>();

export function createTestQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
        gcTime: Number.POSITIVE_INFINITY,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
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
