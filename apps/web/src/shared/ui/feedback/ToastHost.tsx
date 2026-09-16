import { Toast } from "@base-ui/react/toast";

import { momoToastManager } from "@/shared/ui/feedback/Toast";
import { ToastRenderer } from "@/shared/ui/feedback/ToastRenderer";

/** Keep one renderer from the first notification so preparation never replaces a focused toast. */
export function ToastHost() {
  return (
    <Toast.Provider limit={4} toastManager={momoToastManager} timeout={4500}>
      <ToastRenderer />
    </Toast.Provider>
  );
}
