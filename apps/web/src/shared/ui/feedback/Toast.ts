import { Toast } from "@base-ui/react/toast";

export const momoToastManager = Toast.createToastManager();

export type ToastTone = "info" | "success" | "warning" | "danger";

export type ShowToastInput = {
  description?: string;
  priority?: "high" | "low";
  timeout?: number;
  title: string;
  tone?: ToastTone;
};

export function showToast({
  description,
  priority = "low",
  timeout,
  title,
  tone = "info",
}: ShowToastInput) {
  return momoToastManager.add({
    description,
    priority,
    timeout,
    title,
    type: tone,
  });
}

export function closeToast(id?: string) {
  momoToastManager.close(id);
}
