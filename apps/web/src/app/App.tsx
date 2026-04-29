import { QueryClientProvider } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { ErrorBoundary } from "@/app/ErrorBoundary";
import { queryClient } from "@/app/queryClient";
import { DraftReviewPage } from "@/features/draftReview/DraftReviewPage";
import { OcrCapturePage } from "@/features/ocrCapture/OcrCapturePage";

export function App() {
  const location = useLocation();
  const page = location.pathname.startsWith("/review/") ? <DraftReviewPage /> : <OcrCapturePage />;

  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>{page}</ErrorBoundary>
    </QueryClientProvider>
  );
}
