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
