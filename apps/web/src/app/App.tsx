import { Suspense } from "react";
import { Outlet, useLocation } from "react-router-dom";

import { RouteSuspenseFallback } from "@/app/RouteSuspenseFallback";
import { useRouteOrientation } from "@/app/useRouteOrientation";

export function App() {
  const location = useLocation();
  useRouteOrientation();

  return (
    <Suspense
      fallback={
        <RouteSuspenseFallback asMain pathname={location.pathname} search={location.search} />
      }
    >
      <Outlet />
    </Suspense>
  );
}
