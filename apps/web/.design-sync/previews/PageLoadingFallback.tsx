import { PageLoadingFallback } from "momo-result-ui";

export const List = () => (
  <PageLoadingFallback
    contentToolbar={{ actionSize: "sm", actionSlots: 2, actionWidths: ["standard", "wide"] }}
    kind="list"
    loadingLabel="試合一覧を読み込み中"
    width="standard"
  />
);

export const Detail = () => (
  <PageLoadingFallback
    header={{ actionSize: "sm", actionSlots: 2, actionWidths: ["wide", "wide"], description: true }}
    kind="detail"
    loadingLabel="試合詳細を読み込み中"
  />
);

export const RecordList = () => (
  <PageLoadingFallback kind="record-list" loadingLabel="開催履歴を読み込み中" width="standard" />
);
