import type { Query, QueryClient, QueryKey } from "@tanstack/react-query";

import type { AuthMeResponse } from "@/shared/api/auth";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import {
  adminAccountKeys,
  notificationSettingsKeys,
  seriesAnalysisKeys,
  seriesPlayerRadarKeys,
} from "@/shared/api/queryKeys";
import { Authorization } from "@/shared/auth/authorization";
import type {
  AuthorizationLease,
  AuthorizationOperations,
  AuthorizationSessionSource,
} from "@/shared/auth/authorization";
import { authMeQueryKeyFor, authQueryOptions } from "@/shared/auth/authQueries";
import type { ManagementPermission } from "@/shared/auth/permissions";

function startsWith(key: QueryKey, prefix: QueryKey) {
  return prefix.every((value, index) => key[index] === value);
}

function queryPermission(key: QueryKey): ManagementPermission | undefined {
  if (startsWith(key, adminAccountKeys.all()) || startsWith(key, notificationSettingsKeys.all()))
    return "admin";
  if (
    startsWith(key, seriesAnalysisKeys.adminRoot()) ||
    startsWith(key, seriesPlayerRadarKeys.all())
  )
    return "operations";
  return undefined;
}

function isRejected(error: unknown): boolean {
  const status = normalizeUnknownApiError(error).status;
  return status === 401 || status === 403;
}

/** A rejected read waits for an explicit retry even after authentication is restored. */
export function canReadProtectedQuery(
  authorization: Pick<AuthorizationOperations, "can">,
  client: QueryClient,
  permission: ManagementPermission,
  queryKey: QueryKey,
): boolean {
  return authorization.can(permission) && !isRejected(client.getQueryState(queryKey)?.error);
}

function authorizationSessionSource(
  client: QueryClient,
  devUser: string | undefined,
): AuthorizationSessionSource {
  const authKey = authMeQueryKeyFor(devUser);
  return {
    read: () => {
      const state = client.getQueryState<AuthMeResponse | null>(authKey);
      return {
        account: state?.data,
        rejected: isRejected(state?.error),
        ready: state?.status === "success" && state.fetchStatus === "idle",
      };
    },
    observe: (events) => {
      const attempts = new WeakMap<Query, AuthorizationLease>();
      // This binding shares the lifetime of its QueryClient, not a mounted reader.
      client.getQueryCache().subscribe((event) => {
        if (event.type !== "updated" && event.type !== "removed") return;
        if (startsWith(event.query.queryKey, authKey)) {
          events.authenticationChanged(
            event.type === "removed"
              ? "removed"
              : event.action.type === "success"
                ? "accepted"
                : "changed",
          );
          return;
        }
        const permission = queryPermission(event.query.queryKey);
        if (!permission || event.type !== "updated") return;
        if (event.action.type === "fetch") {
          const lease = events.captureRead(permission);
          if (lease) attempts.set(event.query, lease);
        }
        if (event.action.type === "error") {
          const lease = attempts.get(event.query);
          if (lease) events.readFailed(event.action.error, lease);
        }
      });
    },
    clearProtectedReads: (permissions) => {
      const queries = client.getQueryCache().findAll({
        predicate: (query) => {
          const permission = queryPermission(query.queryKey);
          return Boolean(permission && permissions.includes(permission));
        },
      });
      // Cancel immediately, then remove only the captured instances. A later grant
      // may already have created replacement queries under the same keys.
      void Promise.all(
        queries.map((query) => client.cancelQueries({ queryKey: query.queryKey, exact: true })),
      ).then(() => {
        const cache = client.getQueryCache();
        for (const query of queries) {
          if (cache.get(query.queryHash) === query) cache.remove(query);
        }
        return undefined;
      });
    },
    cancelAuthentication: () => client.cancelQueries({ queryKey: authKey, exact: true }),
    refreshAuthentication: async () => {
      await client.fetchQuery({ ...authQueryOptions(devUser), staleTime: 0 });
    },
    replaceSelfRole: (accountId, role) => {
      client.setQueryData<AuthMeResponse | null>(authKey, (current) =>
        current?.accountId === accountId ? { ...current, role } : current,
      );
    },
  };
}

const owners = new WeakMap<QueryClient, Map<string, Authorization>>();

export function getAuthorization(client: QueryClient, devUser?: string): Authorization {
  let byPrincipal = owners.get(client);
  if (!byPrincipal) {
    byPrincipal = new Map();
    owners.set(client, byPrincipal);
  }
  const key = authMeQueryKeyFor(devUser).join(":");
  let owner = byPrincipal.get(key);
  if (!owner) {
    owner = new Authorization(authorizationSessionSource(client, devUser));
    byPrincipal.set(key, owner);
  }
  return owner;
}
