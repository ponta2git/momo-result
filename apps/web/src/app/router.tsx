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
  RootRedirect,
} from "@/app/routeGuards";
import {
  LoginPage,
  loadAchievementsPage,
  loadDraftReviewPage,
  loadDraftsPage,
  loadExportPage,
  loadHeldEventDetailPage,
  loadHeldEventsPage,
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

const DraftReviewPage = lazy(() => loadLazyModule(loadDraftReviewPage));
const DraftsPage = lazy(() => loadLazyModule(loadDraftsPage));
const AchievementsPage = lazy(() => loadLazyModule(loadAchievementsPage));
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
        handle: { title: "ログイン" },
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
            path: "achievements",
            handle: { title: "実績達成" },
            element: <AchievementsPage />,
          },
          {
            path: "matches",
            handle: { title: "試合一覧" },
            element: <MatchesListPage />,
          },
          {
            path: "drafts",
            handle: { title: "確定前の下書き" },
            element: <DraftsPage />,
          },
          {
            path: "held-events",
            handle: { title: "開催履歴" },
            element: <HeldEventsPage />,
          },
          {
            path: "held-events/:heldEventId",
            handle: { title: "開催詳細" },
            element: <HeldEventDetailPage />,
          },
          {
            path: "e/:publicId",
            handle: { title: "開催詳細" },
            element: <HeldEventDetailPage />,
          },
          {
            path: "matches/new",
            handle: { title: "試合を手入力" },
            element: <MatchCreatePage />,
          },
          {
            path: "matches/:matchId",
            handle: { title: "試合詳細" },
            element: <MatchDetailPage />,
          },
          {
            path: "m/:publicId",
            handle: { title: "試合詳細" },
            element: <MatchDetailPage />,
          },
          {
            path: "matches/:matchId/edit",
            handle: { title: "試合を編集" },
            element: <MatchEditPage />,
          },
          {
            path: "ocr/new",
            handle: { title: "結果画像を読み取る" },
            element: <OcrCapturePage />,
          },
          {
            path: "review/:matchSessionId",
            handle: { title: "読み取り結果を確認" },
            element: <DraftReviewPage />,
          },
          {
            path: "exports",
            handle: { title: "戦績を出力" },
            element: <ExportPage />,
          },
          {
            path: "analytics/series",
            handle: { title: "戦績比較" },
            element: <SeriesComparisonPage />,
          },
          {
            path: "admin/analysis",
            handle: { title: "分析管理" },
            element: (
              <OperationsRoute>
                <SeriesAnalysisAdminPage />
              </OperationsRoute>
            ),
          },
          {
            path: "admin/masters",
            handle: { title: "設定管理" },
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
        handle: { title: "ページが見つかりません" },
        element: <NotFoundRoute />,
      },
    ],
  },
];

export const router = createBrowserRouter(appRoutes);
