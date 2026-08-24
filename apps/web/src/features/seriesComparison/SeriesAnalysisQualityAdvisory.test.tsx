import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  SeriesAnalysisEvidenceStrengthWarning,
  SeriesAnalysisQualityAdvisory,
} from "@/features/seriesComparison/SeriesAnalysisQualityAdvisory";

describe("series analysis quality advisories", () => {
  it("stays silent when metric quality is sufficient", () => {
    const { container } = render(<SeriesAnalysisQualityAdvisory status="ok" />);

    expect(container).toBeEmptyDOMElement();
  });

  it("shows only low-quality or unavailable states", () => {
    const { rerender } = render(<SeriesAnalysisQualityAdvisory status="reference" />);
    expect(screen.getByText("参考値")).toBeInTheDocument();

    rerender(<SeriesAnalysisQualityAdvisory status="no_target" />);
    expect(screen.getByText("対象なし")).toBeInTheDocument();
  });

  it("warns about evidence strength only when it is low", () => {
    const { container, rerender } = render(
      <SeriesAnalysisEvidenceStrengthWarning strength="high" />,
    );
    expect(container).toBeEmptyDOMElement();

    rerender(<SeriesAnalysisEvidenceStrengthWarning strength="low" />);
    expect(screen.getByText("信頼度低め")).toBeInTheDocument();
  });
});
