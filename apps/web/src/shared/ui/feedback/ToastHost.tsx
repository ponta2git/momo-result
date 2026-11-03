import { Toast } from "@base-ui/react/toast";

import { momoToastManager } from "@/shared/ui/feedback/Toast";
import { ToastRenderer } from "@/shared/ui/feedback/ToastRenderer";

/**
 * Keep one renderer from the first notification so preparation never replaces a focused toast.
 * The host alone owns limit, lifetime, close, announcement, and placement; callers only report
 * results and never position toasts around their own actions.
 */
export function ToastHost() {
  return (
    <Toast.Provider limit={4} toastManager={momoToastManager} timeout={4500}>
      <ToastRenderer />
    </Toast.Provider>
  );
}
