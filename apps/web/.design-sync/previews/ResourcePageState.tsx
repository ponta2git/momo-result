import { ResourcePageState } from "momo-result-ui";

export const NotFound = () => (
  <ResourcePageState
    backHref="/held-events"
    backLabel="開催履歴へ"
    description="指定された開催は削除されたか、存在しません。開催履歴から別の開催を選んでください。"
    eyebrow="開催記録"
    kind="not-found"
    title="開催が見つかりません"
  />
);

export const LoadError = () => (
  <ResourcePageState
    backHref="/matches"
    backLabel="試合一覧へ"
    description="通信状態を確認して、もう一度お試しください。"
    eyebrow="試合記録"
    kind="error"
    onRetry={() => undefined}
    retryLabel="試合詳細を再読み込み"
    title="試合詳細を読み込めませんでした"
  />
);
