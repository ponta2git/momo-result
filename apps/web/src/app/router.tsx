import type { RouteObject } from "react-router-dom";
import { createBrowserRouter, Navigate, useParams } from "react-router-dom";

import { App } from "@/app/App";
import { AppShell } from "@/app/AppShell";
import { AdminRoute, AuthenticatedRoute, PublicOnlyRoute, RootRedirect } from "@/app/routeGuards";
import { AdminAccountsPage } from "@/features/adminAccounts/AdminAccountsPage";
import { LoginPage } from "@/features/auth/LoginPage";
import { DraftReviewPage } from "@/features/draftReview/DraftReviewPage";
import { ExportPage } from "@/features/exports/ExportPage";
import { HeldEventsPage } from "@/features/heldEvents/HeldEventsPage";
import { MastersPage } from "@/features/masters/MastersPage";
import { MatchCreatePage } from "@/features/matches/MatchCreatePage";
import { MatchDetailPage } from "@/features/matches/MatchDetailPage";
import { MatchesListPage } from "@/features/matches/MatchesListPage";
import { MatchWorkspacePage } from "@/features/matches/workspace/MatchWorkspacePage";
import { OcrCapturePage } from "@/features/ocrCapture/OcrCapturePage";

function MatchEditPage() {
  const { matchId } = useParams<{ matchId: string }>();

  if (!matchId) {
    return <Navigate replace to="/matches" />;
  }

  return <MatchWorkspacePage matchId={matchId} mode="edit" />;
}

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
