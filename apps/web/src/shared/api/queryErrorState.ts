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

export function shouldShowQueryError(query: QueryErrorState): boolean {
  return Boolean(query.error && !query.isFetching);
}

export function shouldShowBlockingQueryError(query: BlockingQueryErrorState): boolean {
  return Boolean(query.isError && query.data === undefined && !query.isFetching);
}

export function isInitialQueryLoading(query: InitialQueryLoadingState): boolean {
  return query.isLoading || (query.data === undefined && query.isFetching);
}
