import { QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "@/app/ErrorBoundary";
import { queryClient } from "@/app/queryClient";
import { OcrCapturePage } from "@/features/ocrCapture/OcrCapturePage";

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <OcrCapturePage />
      </ErrorBoundary>
    </QueryClientProvider>
  );
}
