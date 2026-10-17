import type { AuthMeResponse } from "@/shared/api/auth";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import type { AuthStatus } from "@/shared/auth/authStatus";
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
  readonly auth: AuthStatus;
  readonly allowed: Readonly<Record<ManagementPermission, boolean>>;
  readonly retained: Readonly<Record<ManagementPermission, boolean>>;
  readonly paused: boolean;
  readonly epoch: Readonly<Record<ManagementPermission, number>>;
};

export type AuthorizationEvents = {
  authenticationChanged: (change: "accepted" | "removed" | "changed") => void;
  captureRead: (permission: ManagementPermission) => AuthorizationLease | undefined;
  readFailed: (error: unknown, lease: AuthorizationLease) => void;
};

/** The session's storage owns reads and cancellation; authorization owns permission lifetimes. */
export type AuthorizationSessionSource = {
  read: () => {
    account: AuthMeResponse | null | undefined;
    rejected: boolean;
    ready: boolean;
  };
  observe: (events: AuthorizationEvents) => void;
  clearProtectedReads: (permissions: readonly ManagementPermission[]) => void;
  cancelAuthentication: () => Promise<void>;
  refreshAuthentication: () => Promise<void>;
  replaceSelfRole: (accountId: string, role: AuthMeResponse["role"]) => void;
};

/**
 * The current session remains the authority. This owner only tracks interrupted reads and
 * capability lifetimes so a late completion cannot revive a revoked workflow.
 */
export class Authorization {
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
  private source: AuthorizationSessionSource;

  constructor(source: AuthorizationSessionSource) {
    this.source = source;
    this.updateConfirmed();
    source.observe({
      authenticationChanged: (change) => {
        if (change === "accepted") {
          this.authRevision += 1;
          this.updateConfirmed();
          if (!this.recovering) this.recoveryHandled = false;
        }
        if (change === "removed" || source.read().rejected) this.updateConfirmed();
        this.emit();
      },
      captureRead: (permission) => this.capture(permission),
      readFailed: (error, lease) => this.reportError(error, lease),
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
  private updateConfirmed() {
    const session = this.source.read();
    const auth = session.rejected ? undefined : session.account;
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
      this.source.clearProtectedReads(lost);
    }
  }

  has = (permission: ManagementPermission) => this.confirmed[permission];
  epoch = (permission: ManagementPermission) => this.generations[permission];
  can = (permission: ManagementPermission) =>
    this.has(permission) && this.source.read().ready && !this.recovering && !this.applyingSelfRole;
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
      await this.source.cancelAuthentication();
      await this.source.refreshAuthentication();
    } catch {
      // The session source retains the retryable error and any terminal login rejection.
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
    // Cancellation can restore the old session's ready state. Keep commands and reads
    // paused until the confirmed self-change replaces that old role.
    this.applyingSelfRole = true;
    this.emit();
    try {
      await this.source.cancelAuthentication();
      if (!this.isSameAccount(lease) || lease.authRevision !== this.authRevision) return;
      this.source.replaceSelfRole(lease.accountId, role);
    } finally {
      this.applyingSelfRole = false;
      this.emit();
    }
  };

  readonly operations: AuthorizationOperations = {
    begin: this.begin,
    can: this.can,
    isCurrent: this.isCurrent,
    isSameAccount: this.isSameAccount,
    canCommit: this.canCommit,
    reportError: this.reportError,
    recheck: this.recheck,
    acceptSelfRole: this.acceptSelfRole,
  };
}
