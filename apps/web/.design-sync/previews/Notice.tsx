import { Button, Notice } from "momo-result-ui";

export const Tones = () => (
  <div className="grid gap-3">
    <Notice title="追加の再計算が予約されています" tone="info">
      2件・最古 2026/10/24 21:05
    </Notice>
    <Notice title="試合結果を保存しました" tone="success">
      第12回 桃鉄リーグの順位表に反映されました。
    </Notice>
    <Notice title="適用中の基準が変わりました" tone="warning">
      編集中に別の管理者が採点基準を更新しました。内容を確認してから保存してください。
    </Notice>
    <Notice title="採点基準の状態を読み込めません" tone="danger">
      通信が切断されました。時間をおいて再読み込みしてください。
    </Notice>
  </div>
);

export const WithAction = () => (
  <Notice
    action={
      <Button size="sm" variant="secondary">
        再読み込み
      </Button>
    }
    title="最新の結果を取得できませんでした"
    tone="danger"
  >
    表示中の内容は 5 分前のものです。
  </Notice>
);

export const Presentations = () => (
  <div className="grid gap-3">
    <Notice presentation="contained">
      枠付きの通常表示です。ページ内の独立した案内に使います。
    </Notice>
    <Notice presentation="nested">カードやフォームの内側に置く、角の小さい表示です。</Notice>
    <Notice presentation="bare">枠のない表示です。周囲の面に溶け込ませたい補足に使います。</Notice>
  </div>
);
