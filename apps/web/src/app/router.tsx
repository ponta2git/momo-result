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
  loadHeldEventsPage,
  loadLoginPage,
  loadMastersPage,
  loadMatchCreatePage,
  loadMatchDetailPage,
  loadMatchesListPage,
  loadMatchEditPage,
  loadOcrCapturePage,
} from "@/app/routeModules";

const AdminAccountsPage = lazy(loadAdminAccountsPage);
const LoginPage = lazy(loadLoginPage);
const DraftReviewPage = lazy(loadDraftReviewPage);
const ExportPage = lazy(loadExportPage);
const HeldEventsPage = lazy(loadHeldEventsPage);
const MastersPage = lazy(loadMastersPage);
const MatchCreatePage = lazy(loadMatchCreatePage);
const MatchDetailPage = lazy(loadMatchDetailPage);
const MatchesListPage = lazy(loadMatchesListPage);
const MatchEditPage = lazy(loadMatchEditPage);
const OcrCapturePage = lazy(loadOcrCapturePage);

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
