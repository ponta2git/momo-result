import { Suspense } from "react";
import { Outlet } from "react-router-dom";

import { RouteSuspenseFallback } from "@/shared/ui/feedback/RouteSuspenseFallback";

export function App() {
  return (
    <Suspense fallback={<RouteSuspenseFallback />}>
      <Outlet />
    </Suspense>
  );
}
