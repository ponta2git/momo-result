export type SourceImageKind = "total_assets" | "revenue" | "incident_log";

export type SourceImageItem = {
  contentType?: string;
  createdAt: string;
  imageUrl: string;
  kind: SourceImageKind;
};

export const sourceImageKinds: SourceImageKind[] = ["total_assets", "revenue", "incident_log"];

export const sourceImageKindLabels: Record<SourceImageKind, string> = {
  incident_log: "事件簿",
  revenue: "収益",
  total_assets: "総資産",
};

/**
 * API レスポンスの 1 件を、`SourceImagePanel` が必要とする descriptor 形式に整える。
 * `imageUrl` が空の場合は match-draft 配下のデフォルト URL を組み立てる。
 */
export function toSourceImageDescriptor(
  matchDraftId: string,
  item: { contentType?: string | null; createdAt: string; imageUrl?: string | null; kind: string },
): SourceImageItem {
  const url =
    item.imageUrl ||
    `/api/match-drafts/${encodeURIComponent(matchDraftId)}/source-images/${encodeURIComponent(item.kind)}`;
  const descriptor: SourceImageItem = {
    createdAt: item.createdAt,
    imageUrl: url,
    kind: item.kind as SourceImageKind,
  };
  if (item.contentType) {
    descriptor.contentType = item.contentType;
  }
  return descriptor;
}
