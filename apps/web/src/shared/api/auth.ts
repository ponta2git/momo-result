import { apiRequest } from "@/shared/api/client";
import type { ApiSignalOptions } from "@/shared/api/client";
import { clearCsrfToken, setCsrfToken } from "@/shared/api/csrfTokenStore";
import type { components } from "@/shared/api/generated";

export type AuthMeResponse = components["schemas"]["AuthMeResponse"];

export async function getAuthMe(options: ApiSignalOptions = {}): Promise<AuthMeResponse> {
  try {
    const response = await apiRequest<AuthMeResponse>("/api/auth/me", options);
    setCsrfToken(response.csrfToken ?? undefined);
    return response;
  } catch (error) {
    clearCsrfToken();
    throw error;
  }
}

export async function logout(): Promise<void> {
  await apiRequest<void>("/api/auth/logout", { method: "POST" });
  clearCsrfToken();
}
