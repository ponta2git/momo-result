type QueryErrorState = {
  error: unknown;
  isFetching: boolean;
};

type BlockingQueryErrorState = QueryErrorState & {
  data: unknown | undefined;
  isError: boolean;
};

type InitialQueryLoadingState = {
  data: unknown | undefined;
  isFetching: boolean;
  isLoading: boolean;
};

type StaleShieldState = {
  hasVisibleData?: boolean | undefined;
  isPlaceholderData?: boolean | undefined;
  isRefreshing?: boolean | undefined;
  isSettling?: boolean | undefined;
};

export function shouldShowQueryError(query: QueryErrorState): boolean {
  return Boolean(query.error && !query.isFetching);
}

export function shouldShowBlockingQueryError(query: BlockingQueryErrorState): boolean {
  return Boolean(query.isError && query.data === undefined && !query.isFetching);
}

export function isInitialQueryLoading(query: InitialQueryLoadingState): boolean {
  return query.isLoading || (query.data === undefined && query.isFetching);
}

export function shouldShowStaleShield(state: StaleShieldState): boolean {
  return Boolean(
    state.isSettling || state.isPlaceholderData || (state.hasVisibleData && state.isRefreshing),
  );
}
