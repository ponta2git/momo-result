import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { OcrCapturePage } from "@/features/ocrCapture/OcrCapturePage";
import { queryClient } from "@/app/queryClient";

describe("OcrCapturePage", () => {
  it("uploads an image, creates a job, polls to success, and shows the draft", async () => {
    window.localStorage.setItem("momoresult.devUser", "ponta");

    render(
      <QueryClientProvider client={queryClient}>
        <OcrCapturePage />
      </QueryClientProvider>,
    );

    const input = await screen.findByLabelText("総資産の画像をアップロード");
    await userEvent.upload(input, new File(["image"], "assets.png", { type: "image/png" }));

    await waitFor(() => expect(screen.getByText("OCRドラフト JSON を表示")).toBeInTheDocument());
  });
});
