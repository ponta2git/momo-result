// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  isInitialQueryLoading,
  shouldShowBlockingQueryError,
  shouldShowQueryError,
  shouldShowStaleShield,
} from "./queryErrorState";

describe("queryErrorState", () => {
  it.each([
    {
      error: new Error("failed"),
      expected: true,
      isFetching: false,
      name: "shows the error after fetching settles",
    },
    {
      error: new Error("failed"),
      expected: false,
      isFetching: true,
      name: "keeps a refetching error hidden",
    },
    {
      error: undefined,
      expected: false,
      isFetching: false,
      name: "does not show without an error object",
    },
  ] satisfies Array<{
    error: unknown;
    expected: boolean;
    isFetching: boolean;
    name: string;
  }>)("$name", ({ error, expected, isFetching }) => {
    expect(shouldShowQueryError({ error, isFetching })).toBe(expected);
  });

  it.each([
    {
      data: undefined,
      expected: true,
      isError: true,
      isFetching: false,
      name: "blocks only after an initial error with no cached data and no active fetch",
    },
    {
      data: { id: "cached" },
      expected: false,
      isError: true,
      isFetching: false,
      name: "keeps cached data visible after an error",
    },
    {
      data: undefined,
      expected: false,
      isError: true,
      isFetching: true,
      name: "keeps initial refetch in progress visible",
    },
    {
      data: { id: "cached" },
      expected: false,
      isError: true,
      isFetching: true,
      name: "keeps cached refetch in progress visible",
    },
    {
      data: undefined,
      expected: false,
      isError: false,
      isFetching: false,
      name: "does not block an empty non-error state",
    },
    {
      data: { id: "cached" },
      expected: false,
      isError: false,
      isFetching: false,
      name: "does not block cached non-error state",
    },
    {
      data: undefined,
      expected: false,
      isError: false,
      isFetching: true,
      name: "does not block initial loading",
    },
    {
      data: { id: "cached" },
      expected: false,
      isError: false,
      isFetching: true,
      name: "does not block background refresh",
    },
  ] satisfies Array<{
    data: unknown | undefined;
    expected: boolean;
    isError: boolean;
    isFetching: boolean;
    name: string;
  }>)("$name", ({ data, expected, isError, isFetching }) => {
    expect(
      shouldShowBlockingQueryError({ data, error: new Error("failed"), isError, isFetching }),
    ).toBe(expected);
  });

  it.each([
    {
      data: undefined,
      expected: true,
      isFetching: false,
      isLoading: true,
      name: "is loading while the query reports initial loading",
    },
    {
      data: { id: "cached" },
      expected: true,
      isFetching: false,
      isLoading: true,
      name: "keeps the loading flag authoritative even with data",
    },
    {
      data: undefined,
      expected: true,
      isFetching: true,
      isLoading: false,
      name: "is loading while the first fetch is in flight",
    },
    {
      data: { id: "cached" },
      expected: false,
      isFetching: true,
      isLoading: false,
      name: "does not treat background refresh as initial loading",
    },
    {
      data: undefined,
      expected: false,
      isFetching: false,
      isLoading: false,
      name: "is not loading after an empty settled state",
    },
    {
      data: { id: "cached" },
      expected: false,
      isFetching: false,
      isLoading: false,
      name: "is not loading after cached settled state",
    },
  ] satisfies Array<{
    data: unknown | undefined;
    expected: boolean;
    isFetching: boolean;
    isLoading: boolean;
    name: string;
  }>)("$name", ({ data, expected, isFetching, isLoading }) => {
    expect(isInitialQueryLoading({ data, isFetching, isLoading })).toBe(expected);
  });

  it.each([
    {
      expected: true,
      name: "shields while UI state is settling",
      state: { isSettling: true },
    },
    {
      expected: true,
      name: "shields placeholder data",
      state: { isPlaceholderData: true },
    },
    {
      expected: true,
      name: "shields visible data during refresh",
      state: { hasVisibleData: true, isRefreshing: true },
    },
    {
      expected: false,
      name: "does not shield initial refresh without visible data",
      state: { hasVisibleData: false, isRefreshing: true },
    },
    {
      expected: false,
      name: "does not shield a settled fresh view",
      state: {},
    },
  ] satisfies Array<{
    expected: boolean;
    name: string;
    state: Parameters<typeof shouldShowStaleShield>[0];
  }>)("$name", ({ expected, state }) => {
    expect(shouldShowStaleShield(state)).toBe(expected);
  });
});
