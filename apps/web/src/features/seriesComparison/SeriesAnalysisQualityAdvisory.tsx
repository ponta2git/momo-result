import { TriangleAlert } from "lucide-react";

import type {
  DataQualityStatus,
  SeriesAnalysisPlaybookEvidenceStrength,
} from "@/shared/api/seriesAnalysis";
export function qualityAdvisoryLabel(status: DataQualityStatus): string | null {
  switch (status) {
    case "ok":
      return null;
    case "reference":
      return "参考値";
    case "no_target":
      return "対象なし";
  }
}

export function SeriesAnalysisQualityAdvisory({ status }: { status: DataQualityStatus }) {
  const label = qualityAdvisoryLabel(status);
  if (!label) return null;

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs ${status === "reference" ? "font-semibold text-[var(--color-text-primary)]" : "text-[var(--color-text-muted)]"}`}
    >
      {status === "reference" ? (
        <TriangleAlert
          aria-hidden="true"
          className="size-3.5 shrink-0 text-[var(--color-warning)]"
        />
      ) : null}
      {label}
    </span>
  );
}

export function lowEvidenceStrengthWarningLabel(
  strength: SeriesAnalysisPlaybookEvidenceStrength | undefined,
): string | null {
  return strength === "low" || strength === undefined ? "信頼度低め" : null;
}

export function SeriesAnalysisEvidenceStrengthWarning({
  strength,
}: {
  strength: SeriesAnalysisPlaybookEvidenceStrength | undefined;
}) {
  const label = lowEvidenceStrengthWarningLabel(strength);
  if (!label) return null;

  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-text-primary)]">
      <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0 text-[var(--color-warning)]" />
      {label}
    </span>
  );
}
