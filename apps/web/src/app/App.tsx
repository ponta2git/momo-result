import { QueryClientProvider } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";

import { ErrorBoundary } from "@/app/ErrorBoundary";
import { queryClient } from "@/app/queryClient";
import { DraftReviewPage } from "@/features/draftReview/DraftReviewPage";
import { ExportPage } from "@/features/exports/ExportPage";
import { MastersPage } from "@/features/masters/MastersPage";
import { MatchDetailPage } from "@/features/matches/MatchDetailPage";
import { MatchEditPage } from "@/features/matches/MatchEditPage";
import { MatchesListPage } from "@/features/matches/MatchesListPage";
import { OcrCapturePage } from "@/features/ocrCapture/OcrCapturePage";
import { DialogHost } from "@/shared/ui/feedback/DialogHost";
import { ToastHost } from "@/shared/ui/feedback/ToastHost";

export function App() {
  const location = useLocation();
  let page;
  if (location.pathname.startsWith("/review/")) {
    page = <DraftReviewPage />;
  } else if (location.pathname.startsWith("/exports")) {
    page = <ExportPage />;
  } else if (location.pathname.startsWith("/admin/masters")) {
    page = <MastersPage />;
  } else if (/^\/matches\/[^/]+\/edit$/.test(location.pathname)) {
    page = <MatchEditPage />;
  } else if (/^\/matches\/[^/]+$/.test(location.pathname)) {
    page = <MatchDetailPage />;
  } else if (location.pathname === "/matches" || location.pathname.startsWith("/matches?")) {
    page = <MatchesListPage />;
  } else {
    page = <OcrCapturePage />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <DialogHost>
        <ErrorBoundary>{page}</ErrorBoundary>
        <ToastHost />
      </DialogHost>
    </QueryClientProvider>
  );
}
