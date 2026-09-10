import { apiRequest } from "@/shared/api/client";
import type { ApiSignalOptions, IdempotencyRequestOptions } from "@/shared/api/client";
import type { components } from "@/shared/api/generated";

export type NotificationSettings = components["schemas"]["NotificationSettingsResponse"];
export type NotificationSettingsUpdate = components["schemas"]["NotificationSettingsUpdateRequest"];

export function getNotificationSettings(
  options: ApiSignalOptions = {},
): Promise<NotificationSettings> {
  return apiRequest("/api/admin/notification-settings", options);
}

export function updateNotificationSettings(
  request: NotificationSettingsUpdate,
  options: IdempotencyRequestOptions,
): Promise<NotificationSettings> {
  return apiRequest("/api/admin/notification-settings", {
    method: "PUT",
    body: request,
    idempotency: { key: options.idempotencyKey },
  });
}
