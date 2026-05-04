import type {
  SourceImageItem,
  SourceImageKind,
} from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import {
  sourceImageKindLabels,
  sourceImageKinds,
} from "@/features/matches/workspace/sourceImages/sourceImageTypes";

type SourceImageState =
  | { description: string; kind: SourceImageKind; status: "available"; url: string }
  | { description: string; kind: SourceImageKind; status: "missing" };

export function toSourceImageStates(items: SourceImageItem[] | undefined): SourceImageState[] {
  const byKind = new Map(items?.map((item) => [item.kind, item]));

  return sourceImageKinds.map((kind) => {
    const item = byKind.get(kind);
    if (!item?.imageUrl) {
      return {
        description: `${sourceImageKindLabels[kind]}の元画像はまだ登録されていません。`,
        kind,
        status: "missing",
      };
    }

    return {
      description: `${sourceImageKindLabels[kind]}の元画像です。`,
      kind,
      status: "available",
      url: item.imageUrl,
    };
  });
}
