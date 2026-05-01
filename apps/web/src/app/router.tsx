import { createBrowserRouter, Navigate } from "react-router-dom";

import { App } from "@/app/App";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
  },
  {
    path: "/ocr/new",
    element: <App />,
  },
  {
    path: "/review/:matchSessionId",
    element: <App />,
  },
  {
    path: "/admin/masters",
    element: <App />,
  },
  {
    path: "/matches",
    element: <App />,
  },
  {
    path: "/matches/:matchId",
    element: <App />,
  },
  {
    path: "/matches/:matchId/edit",
    element: <App />,
  },
  {
    path: "/exports",
    element: <App />,
  },
  {
    path: "*",
    element: <Navigate to="/ocr/new" replace />,
  },
]);
