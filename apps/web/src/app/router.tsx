import { lazy } from "react";
import type { RouteObject } from "react-router-dom";
import { createBrowserRouter, Navigate } from "react-router-dom";

import { App } from "@/app/App";
import { AppShell } from "@/app/AppShell";
import { AdminRoute, AuthenticatedRoute, PublicOnlyRoute, RootRedirect } from "@/app/routeGuards";
import {
  loadAdminAccountsPage,
  loadDraftReviewPage,
  loadExportPage,
  loadHeldEventDetailPage,
  loadHeldEventsPage,
  loadLoginPage,
  loadMastersPage,
  loadMatchCreatePage,
  loadMatchDetailPage,
  loadMatchesListPage,
  loadMatchEditPage,
  loadOcrCapturePage,
  loadSeriesComparisonPage,
  loadSeriesAnalysisAdminPage,
} from "@/app/routeModules";
import { loadLazyModule } from "@/shared/lib/moduleLoadError";

const AdminAccountsPage = lazy(() => loadLazyModule(loadAdminAccountsPage));
const LoginPage = lazy(() => loadLazyModule(loadLoginPage));
const DraftReviewPage = lazy(() => loadLazyModule(loadDraftReviewPage));
const ExportPage = lazy(() => loadLazyModule(loadExportPage));
const HeldEventDetailPage = lazy(() => loadLazyModule(loadHeldEventDetailPage));
const HeldEventsPage = lazy(() => loadLazyModule(loadHeldEventsPage));
const MastersPage = lazy(() => loadLazyModule(loadMastersPage));
const MatchCreatePage = lazy(() => loadLazyModule(loadMatchCreatePage));
const MatchDetailPage = lazy(() => loadLazyModule(loadMatchDetailPage));
const MatchesListPage = lazy(() => loadLazyModule(loadMatchesListPage));
const MatchEditPage = lazy(() => loadLazyModule(loadMatchEditPage));
const OcrCapturePage = lazy(() => loadLazyModule(loadOcrCapturePage));
const SeriesComparisonPage = lazy(() => loadLazyModule(loadSeriesComparisonPage));
const SeriesAnalysisAdminPage = lazy(() => loadLazyModule(loadSeriesAnalysisAdminPage));

export const appRoutes: RouteObject[] = [
  {
    path: "/",
    element: <App />,
    children: [
      {
        index: true,
        element: <RootRedirect />,
      },
      {
        path: "login",
        element: (
          <PublicOnlyRoute>
            <LoginPage />
          </PublicOnlyRoute>
        ),
      },
      {
        element: (
          <AuthenticatedRoute>
            <AppShell />
          </AuthenticatedRoute>
        ),
        children: [
          {
            path: "matches",
            element: <MatchesListPage />,
          },
          {
            path: "held-events",
            element: <HeldEventsPage />,
          },
          {
            path: "held-events/:heldEventId",
            element: <HeldEventDetailPage />,
          },
          {
            path: "matches/new",
            element: <MatchCreatePage />,
          },
          {
            path: "matches/:matchId",
            element: <MatchDetailPage />,
          },
          {
            path: "matches/:matchId/edit",
            element: <MatchEditPage />,
          },
          {
            path: "ocr/new",
            element: <OcrCapturePage />,
          },
          {
            path: "review/:matchSessionId",
            element: <DraftReviewPage />,
          },
          {
            path: "exports",
            element: <ExportPage />,
          },
          {
            path: "analytics/series",
            element: <SeriesComparisonPage />,
          },
          {
            path: "admin/analysis",
            element: (
              <AdminRoute>
                <SeriesAnalysisAdminPage />
              </AdminRoute>
            ),
          },
          {
            path: "admin/masters",
            element: (
              <AdminRoute>
                <MastersPage />
              </AdminRoute>
            ),
          },
          {
            path: "admin/accounts",
            element: (
              <AdminRoute>
                <AdminAccountsPage />
              </AdminRoute>
            ),
          },
        ],
      },
      {
        path: "*",
        element: <Navigate replace to="/" />,
      },
    ],
  },
];

export const router = createBrowserRouter(appRoutes);
