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
    path: "*",
    element: <Navigate to="/ocr/new" replace />,
  },
]);
