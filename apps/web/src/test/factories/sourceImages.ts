import { sourceImageKinds } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import type {
  SourceImageItem,
  SourceImageKind,
} from "@/features/matches/workspace/sourceImages/sourceImageTypes";

const defaultCreatedAt = "2026-01-01T00:00:00.000Z";

export function makeSourceImageItems(
  draftId = "draft-1",
  kinds: readonly SourceImageKind[] = sourceImageKinds,
): SourceImageItem[] {
  return kinds.map((kind) => ({
    contentType: "image/png",
    createdAt: defaultCreatedAt,
    imageUrl: `/api/match-drafts/${draftId}/source-images/${kind}`,
    kind,
  }));
}
