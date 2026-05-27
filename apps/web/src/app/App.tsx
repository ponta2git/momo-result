import { Suspense } from "react";
import { Outlet, useLocation } from "react-router-dom";

import { RouteSuspenseFallback } from "@/shared/ui/feedback/RouteSuspenseFallback";

export function App() {
  const location = useLocation();

  return (
    <Suspense fallback={<RouteSuspenseFallback asMain pathname={location.pathname} />}>
      <Outlet />
    </Suspense>
  );
}
