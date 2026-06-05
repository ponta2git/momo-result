import type { MatchDraftSourceImageResponse } from "@/shared/api/matchDrafts";

const defaultCreatedAt = "2026-01-01T00:00:00.000Z";
const sourceImageKinds = ["total_assets", "revenue", "incident_log"] as const;

type SourceImageKind = (typeof sourceImageKinds)[number];
type MatchDraftSourceImageFixture = Omit<MatchDraftSourceImageResponse, "kind"> & {
  kind: SourceImageKind;
};

export function makeMatchDraftSourceImageResponses(
  draftId = "draft-1",
  kinds: readonly SourceImageKind[] = sourceImageKinds,
): MatchDraftSourceImageFixture[] {
  return kinds.map((kind) => ({
    contentType: "image/png",
    createdAt: defaultCreatedAt,
    imageUrl: `/api/match-drafts/${draftId}/source-images/${kind}`,
    kind,
  }));
}
