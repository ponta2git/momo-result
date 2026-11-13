import { lazy } from "react";
import type { RouteObject } from "react-router-dom";
import { createBrowserRouter } from "react-router-dom";

import { App } from "@/app/App";
import { AppShell } from "@/app/AppShell";
import {
  OperationsRoute,
  AuthenticatedRoute,
  NotFoundRoute,
  PublicOnlyRoute,
} from "@/app/routeGuards";
import type { RouteHandle } from "@/app/routeHandle";
import {
  LoginPage,
  loadAchievementsPage,
  loadDraftReviewPage,
  loadDraftsPage,
  loadExportPage,
  loadHeldEventDetailPage,
  loadHeldEventsPage,
  loadLatestHeldEventRedirect,
  loadMastersPage,
  loadMatchCreatePage,
  loadMatchDetailPage,
  loadMatchesListPage,
  loadMatchEditPage,
  loadOcrCapturePage,
  loadSeriesComparisonPage,
  loadSeriesAnalysisAdminPage,
  preloadRouteModule,
} from "@/app/routeModules";
import { loadLazyModule } from "@/shared/lib/moduleLoadError";

const DraftReviewPage = lazy(() => loadLazyModule(loadDraftReviewPage));
const DraftsPage = lazy(() => loadLazyModule(loadDraftsPage));
const AchievementsPage = lazy(() => loadLazyModule(loadAchievementsPage));
const ExportPage = lazy(() => loadLazyModule(loadExportPage));
const HeldEventDetailPage = lazy(() => loadLazyModule(loadHeldEventDetailPage));
const HeldEventsPage = lazy(() => loadLazyModule(loadHeldEventsPage));
// The entry always lands on a hub, so that module loads alongside the newest event's read.
const LatestHeldEventRedirect = lazy(() => {
  preloadRouteModule(loadHeldEventDetailPage);
  return loadLazyModule(loadLatestHeldEventRedirect);
});
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
        path: "login",
        handle: { title: "ログイン" } satisfies RouteHandle,
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
            // Opening the app shows the newest held event, where tonight's record continues.
            index: true,
            handle: { navArea: "heldEvents", title: "最新の開催" } satisfies RouteHandle,
            element: <LatestHeldEventRedirect />,
          },
          {
            path: "achievements",
            handle: { navArea: "achievements", title: "実績達成" } satisfies RouteHandle,
            element: <AchievementsPage />,
          },
          {
            path: "matches",
            handle: { navArea: "matches", title: "試合一覧" } satisfies RouteHandle,
            element: <MatchesListPage />,
          },
          {
            path: "drafts",
            handle: { navArea: "record", title: "確定前の下書き" } satisfies RouteHandle,
            element: <DraftsPage />,
          },
          {
            path: "held-events",
            handle: { navArea: "heldEvents", title: "開催履歴" } satisfies RouteHandle,
            element: <HeldEventsPage />,
          },
          {
            path: "held-events/:heldEventId",
            handle: { navArea: "heldEvents", title: "開催詳細" } satisfies RouteHandle,
            element: <HeldEventDetailPage />,
          },
          {
            path: "e/:publicId",
            handle: { navArea: "heldEvents", title: "開催詳細" } satisfies RouteHandle,
            element: <HeldEventDetailPage />,
          },
          {
            path: "matches/new",
            handle: { navArea: "record", title: "試合を手入力" } satisfies RouteHandle,
            element: <MatchCreatePage />,
          },
          {
            path: "matches/:matchId",
            handle: { navArea: "matches", title: "試合詳細" } satisfies RouteHandle,
            element: <MatchDetailPage />,
          },
          {
            path: "m/:publicId",
            handle: { navArea: "matches", title: "試合詳細" } satisfies RouteHandle,
            element: <MatchDetailPage />,
          },
          {
            path: "matches/:matchId/edit",
            handle: { navArea: "matches", title: "試合を編集" } satisfies RouteHandle,
            element: <MatchEditPage />,
          },
          {
            path: "ocr/new",
            handle: { navArea: "record", title: "結果画像を読み取る" } satisfies RouteHandle,
            element: <OcrCapturePage />,
          },
          {
            path: "review/:matchSessionId",
            handle: { navArea: "record", title: "読み取り結果を確認" } satisfies RouteHandle,
            element: <DraftReviewPage />,
          },
          {
            path: "exports",
            handle: { navArea: "matches", title: "戦績を出力" } satisfies RouteHandle,
            element: <ExportPage />,
          },
          {
            path: "analytics/series",
            handle: { navArea: "analytics", title: "戦績比較" } satisfies RouteHandle,
            element: <SeriesComparisonPage />,
          },
          {
            path: "admin/analysis",
            handle: { navArea: "adminAnalysis", title: "分析管理" } satisfies RouteHandle,
            element: (
              <OperationsRoute>
                <SeriesAnalysisAdminPage />
              </OperationsRoute>
            ),
          },
          {
            path: "admin/masters",
            handle: { navArea: "adminMasters", title: "設定管理" } satisfies RouteHandle,
            element: (
              <OperationsRoute>
                <MastersPage />
              </OperationsRoute>
            ),
          },
        ],
      },
      {
        path: "*",
        handle: { title: "ページが見つかりません" } satisfies RouteHandle,
        element: <NotFoundRoute />,
      },
    ],
  },
];

export const router = createBrowserRouter(appRoutes);
