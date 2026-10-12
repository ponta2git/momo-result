import { QueryClient } from "@tanstack/react-query";

import { retryProtectedQuery } from "@/shared/api/queryRetry";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      retry: retryProtectedQuery,
      staleTime: 10_000,
      throwOnError: false,
    },
    mutations: {
      retry: false,
    },
  },
});
