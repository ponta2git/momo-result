export type ManagementPermission = "operations" | "admin";

export function hasOperationsRole(role: string | undefined): boolean {
  return role === "operator" || role === "admin";
}

export function hasAdminRole(role: string | undefined): boolean {
  return role === "admin";
}
