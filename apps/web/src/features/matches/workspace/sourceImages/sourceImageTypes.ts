export type SourceImageKind = "total_assets" | "revenue" | "incident_log";

export type SourceImageItem = {
  contentType?: string;
  createdAt: string;
  imageUrl: string;
  kind: SourceImageKind;
};

export const sourceImageKinds: SourceImageKind[] = ["total_assets", "revenue", "incident_log"];

export const sourceImageKindLabels = {
  incident_log: "事件簿",
  revenue: "収益",
  total_assets: "総資産",
} as const satisfies Record<SourceImageKind, string>;

export function parseSourceImageKind(value: string): SourceImageKind | undefined {
  return sourceImageKinds.find((kind) => kind === value);
}

function defaultSourceImageUrl(matchDraftId: string, kind: SourceImageKind): string {
  return `/api/match-drafts/${encodeURIComponent(matchDraftId)}/source-images/${encodeURIComponent(
    kind,
  )}`;
}

function normalizeSourceImageUrl(
  matchDraftId: string,
  kind: SourceImageKind,
  imageUrl: string | null | undefined,
): string | undefined {
  const expected = defaultSourceImageUrl(matchDraftId, kind);
  if (!imageUrl) {
    return expected;
  }

  try {
    const parsed = new URL(imageUrl, "https://momo-result.local");
    if (parsed.origin !== "https://momo-result.local") {
      return undefined;
    }
    if (parsed.pathname !== expected) {
      return undefined;
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return undefined;
  }
}

/**
 * API レスポンスの 1 件を、`SourceImagePanel` が必要とする descriptor 形式に整える。
 * `imageUrl` が空の場合は match-draft 配下のデフォルト URL を組み立てる。
 */
export function toSourceImageDescriptor(
  matchDraftId: string,
  item: { contentType?: string | null; createdAt: string; imageUrl?: string | null; kind: string },
): SourceImageItem | undefined {
  const kind = parseSourceImageKind(item.kind);
  if (!kind) {
    return undefined;
  }
  const url = normalizeSourceImageUrl(matchDraftId, kind, item.imageUrl);
  if (!url) {
    return undefined;
  }
  const descriptor: SourceImageItem = {
    createdAt: item.createdAt,
    imageUrl: url,
    kind,
  };
  if (item.contentType) {
    descriptor.contentType = item.contentType;
  }
  return descriptor;
}
