import type { Query, QueryClient, QueryKey } from "@tanstack/react-query";

import type { AuthMeResponse } from "@/shared/api/auth";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import {
  adminAccountKeys,
  notificationSettingsKeys,
  seriesAnalysisKeys,
  seriesPlayerRadarKeys,
} from "@/shared/api/queryKeys";
import { authMeQueryKeyFor, authQueryOptions } from "@/shared/auth/authQueries";
import type { AuthReadModel } from "@/shared/auth/authReadModel";
import { hasAdminRole, hasOperationsRole } from "@/shared/auth/permissions";
import type { ManagementPermission } from "@/shared/auth/permissions";

export type AuthorizationLease = {
  accountId: string;
  permission: ManagementPermission;
  generation: number;
  authRevision: number;
  recovery: number;
};

/** Stable operations always consult the current account and permission generation. */
export type AuthorizationOperations = {
  readonly begin: (permission: ManagementPermission) => AuthorizationLease | undefined;
  readonly can: (permission: ManagementPermission) => boolean;
  readonly canRead: (permission: ManagementPermission, queryKey: QueryKey) => boolean;
  readonly isCurrent: (lease: AuthorizationLease) => boolean;
  readonly isSameAccount: (lease: AuthorizationLease) => boolean;
  readonly canCommit: (lease: AuthorizationLease) => boolean;
  readonly reportError: (error: unknown, lease: AuthorizationLease) => void;
  readonly recheck: () => Promise<void>;
  readonly acceptSelfRole: (
    lease: AuthorizationLease,
    role: AuthMeResponse["role"],
  ) => Promise<void>;
};

export type PermissionFacts = {
  readonly allowed: boolean;
  readonly retained: boolean;
  readonly epoch: number;
};

/** Full route/recovery facts. Ordinary command owners can depend only on operations. */
export type AuthorizationAccess = AuthorizationOperations & {
  readonly revision: number;
  readonly auth: AuthReadModel;
  readonly allowed: Readonly<Record<ManagementPermission, boolean>>;
  readonly retained: Readonly<Record<ManagementPermission, boolean>>;
  readonly paused: boolean;
  readonly epoch: Readonly<Record<ManagementPermission, number>>;
};

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

/**
 * Auth query data remains the authority. This owner only tracks interrupted reads and
 * capability lifetimes so a late completion cannot revive a revoked workflow.
 */
class Authorization {
  private listeners = new Set<() => void>();
  private permissionViews = new Map<ManagementPermission, PermissionFacts>();
  private version = 0;
  private generations = { admin: 0, operations: 0 };
  private confirmed = { accountId: "", admin: false, operations: false };
  private authRevision = 0;
  private recovery = 0;
  private recoveryHandled = false;
  private recovering = false;
  private applyingSelfRole = false;
  private queryAttempts = new WeakMap<Query, AuthorizationLease>();
  private authKey: QueryKey;
  private client: QueryClient;
  private devUser: string | undefined;

  constructor(client: QueryClient, devUser: string | undefined) {
    this.client = client;
    this.devUser = devUser;
    this.authKey = authMeQueryKeyFor(devUser);
    this.updateConfirmed();
    client.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" && event.type !== "removed") return;
      if (startsWith(event.query.queryKey, this.authKey)) {
        if (event.type === "updated" && event.action.type === "success") {
          this.authRevision += 1;
          this.updateConfirmed();
          if (!this.recovering) this.recoveryHandled = false;
        }
        if (event.type === "removed" || this.authRejected()) this.updateConfirmed();
        this.emit();
        return;
      }
      const permission = queryPermission(event.query.queryKey);
      if (!permission || event.type !== "updated") return;
      if (event.action.type === "fetch") {
        const lease = this.capture(permission);
        if (lease) this.queryAttempts.set(event.query, lease);
      }
      if (event.action.type === "error") {
        const lease = this.queryAttempts.get(event.query);
        if (lease) this.reportError(event.action.error, lease);
      }
    });
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = () => this.version;
  permissionSnapshot = (permission: ManagementPermission): PermissionFacts => {
    const previous = this.permissionViews.get(permission);
    const allowed = this.can(permission);
    const retained = this.has(permission);
    const epoch = this.epoch(permission);
    if (previous?.allowed === allowed && previous.retained === retained && previous.epoch === epoch)
      return previous;
    const next = { allowed, retained, epoch };
    this.permissionViews.set(permission, next);
    return next;
  };
  private emit() {
    this.version += 1;
    this.listeners.forEach((listener) => listener());
  }
  private authState() {
    return this.client.getQueryState<AuthMeResponse | null>(this.authKey);
  }
  private authRejected() {
    const status = normalizeUnknownApiError(this.authState()?.error).status;
    return status === 401 || status === 403;
  }
  private updateConfirmed() {
    const auth = this.authRejected() ? undefined : this.authState()?.data;
    const next = {
      accountId: auth?.accountId ?? "",
      admin: hasAdminRole(auth?.role),
      operations: hasOperationsRole(auth?.role),
    };
    const principalChanged = Boolean(
      this.confirmed.accountId && next.accountId !== this.confirmed.accountId,
    );
    const lost = (["admin", "operations"] as const).filter(
      (permission) => principalChanged || (this.confirmed[permission] && !next[permission]),
    );
    this.confirmed = next;
    for (const permission of lost) this.generations[permission] += 1;
    if (lost.length > 0) {
      const queries = this.client.getQueryCache().findAll({
        predicate: (query) => {
          const permission = queryPermission(query.queryKey);
          return Boolean(permission && lost.includes(permission));
        },
      });
      // Cancellation reaches the fetch signal immediately. Remove only these old owners,
      // never a new query created after a subsequent grant.
      void Promise.all(
        queries.map((query) =>
          this.client.cancelQueries({ queryKey: query.queryKey, exact: true }),
        ),
      ).then(() => {
        const cache = this.client.getQueryCache();
        queries.forEach((query) => {
          if (cache.get(query.queryHash) === query) cache.remove(query);
        });
        return undefined;
      });
    }
  }

  has = (permission: ManagementPermission) => this.confirmed[permission];
  epoch = (permission: ManagementPermission) => this.generations[permission];
  can = (permission: ManagementPermission) => {
    const state = this.authState();
    return (
      this.has(permission) &&
      state?.status === "success" &&
      state.fetchStatus === "idle" &&
      !this.recovering &&
      !this.applyingSelfRole
    );
  };
  canRead = (permission: ManagementPermission, queryKey: QueryKey) => {
    const status = normalizeUnknownApiError(this.client.getQueryState(queryKey)?.error).status;
    return this.can(permission) && status !== 401 && status !== 403;
  };
  private capture(permission: ManagementPermission): AuthorizationLease | undefined {
    if (!this.has(permission)) return undefined;
    return {
      accountId: this.confirmed.accountId,
      permission,
      generation: this.generations[permission],
      authRevision: this.authRevision,
      recovery: this.recovery,
    };
  }
  begin = (permission: ManagementPermission): AuthorizationLease | undefined => {
    if (!this.can(permission)) return undefined;
    // Only a deliberate read/command starts another opportunity to recover from 403.
    this.recoveryHandled = false;
    return this.capture(permission);
  };
  isSameAccount = (lease: AuthorizationLease) => lease.accountId === this.confirmed.accountId;
  isCurrent = (lease: AuthorizationLease) =>
    this.isSameAccount(lease) &&
    this.has(lease.permission) &&
    lease.generation === this.generations[lease.permission];
  canCommit = (lease: AuthorizationLease) => this.isCurrent(lease) && this.can(lease.permission);

  reportError = (error: unknown, lease: AuthorizationLease) => {
    const { status } = normalizeUnknownApiError(error);
    if (
      (status !== 401 && status !== 403) ||
      !this.isCurrent(lease) ||
      lease.recovery !== this.recovery ||
      this.recovering ||
      this.recoveryHandled
    )
      return;
    void this.recheck();
  };
  recheck = async () => {
    if (this.recovering) return;
    this.recovery += 1;
    this.recoveryHandled = true;
    this.recovering = true;
    this.emit();
    try {
      await this.client.cancelQueries({ queryKey: this.authKey, exact: true });
      await this.client.fetchQuery({ ...authQueryOptions(this.devUser), staleTime: 0 });
    } catch {
      // The auth query owns the retryable error and any terminal login rejection.
    } finally {
      this.recovering = false;
      this.emit();
    }
  };

  acceptSelfRole = async (lease: AuthorizationLease, role: AuthMeResponse["role"]) => {
    if (!this.isSameAccount(lease)) return;
    if (lease.authRevision !== this.authRevision || !this.isCurrent(lease)) {
      await this.recheck();
      return;
    }
    // Cancellation restores the old auth query's idle state. Keep commands and reads
    // paused until the confirmed self-change replaces that old role.
    this.applyingSelfRole = true;
    this.emit();
    try {
      await this.client.cancelQueries({ queryKey: this.authKey, exact: true });
      if (!this.isSameAccount(lease) || lease.authRevision !== this.authRevision) return;
      this.client.setQueryData<AuthMeResponse | null>(this.authKey, (current) =>
        current?.accountId === lease.accountId ? { ...current, role } : current,
      );
    } finally {
      this.applyingSelfRole = false;
      this.emit();
    }
  };

  readonly operations: AuthorizationOperations = {
    begin: this.begin,
    can: this.can,
    canRead: this.canRead,
    isCurrent: this.isCurrent,
    isSameAccount: this.isSameAccount,
    canCommit: this.canCommit,
    reportError: this.reportError,
    recheck: this.recheck,
    acceptSelfRole: this.acceptSelfRole,
  };
}

const owners = new WeakMap<QueryClient, Map<string, Authorization>>();

export function getAuthorization(client: QueryClient, devUser?: string) {
  let byPrincipal = owners.get(client);
  if (!byPrincipal) {
    byPrincipal = new Map();
    owners.set(client, byPrincipal);
  }
  const key = authMeQueryKeyFor(devUser).join(":");
  let owner = byPrincipal.get(key);
  if (!owner) {
    owner = new Authorization(client, devUser);
    byPrincipal.set(key, owner);
  }
  return owner;
}
