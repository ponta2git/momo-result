import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import { ErrorBoundary } from "@/app/ErrorBoundary";
import { queryClient } from "@/app/queryClient";
import { router } from "@/app/router";
import { TooltipProvider } from "@/shared/ui/feedback/Tooltip";
import { AppMotionProvider } from "@/shared/ui/motion/AppMotionProvider";

import "@/styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ErrorBoundary>
          <AppMotionProvider>
            <RouterProvider router={router} />
          </AppMotionProvider>
        </ErrorBoundary>
      </TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
