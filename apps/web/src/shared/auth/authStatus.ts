import type { AuthMeResponse } from "@/shared/api/auth";
import type { NormalizedApiError } from "@/shared/api/problemDetails";

/** Authentication facts shared by route and permission readers; no logout state or mutation. */
export type AuthStatus = {
  readonly auth: AuthMeResponse | undefined;
  readonly error: NormalizedApiError | undefined;
  readonly isAuthenticated: boolean;
  readonly isChecking: boolean;
  readonly isForbidden: boolean;
  readonly isRefetching: boolean;
  readonly isUnauthorized: boolean;
  readonly refetch: () => Promise<void>;
};
