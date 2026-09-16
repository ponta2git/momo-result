import { Toast } from "@base-ui/react/toast";

export const momoToastManager = Toast.createToastManager();

export type ToastTone = "info" | "success" | "warning" | "danger";

export type ShowToastInput = {
  /** Stable only for the same execution result, never a message or resource type. */
  id?: string;
  description?: string;
  priority?: "high" | "low";
  timeout?: number;
  title: string;
  tone?: ToastTone;
};

export function showToast({
  id,
  description,
  priority = "low",
  timeout,
  title,
  tone = "info",
}: ShowToastInput) {
  return momoToastManager.add({
    id,
    description,
    priority,
    timeout,
    title,
    type: tone,
  });
}
