import { Plus } from "lucide-react";
import { Button, PageHeader, StatusBadge } from "momo-result-ui";

export const WithActions = () => (
  <PageHeader
    actions={<Button icon={<Plus aria-hidden="true" />}>試合を登録</Button>}
    description="開催ごとの試合結果と最終順位を確認できます。"
    eyebrow="桃鉄リーグ 2026"
    title="試合結果"
  />
);

export const WithStatus = () => (
  <PageHeader
    actions={
      <>
        <Button variant="quiet">キャンセル</Button>
        <Button variant="secondary">下書きを保存</Button>
      </>
    }
    description="読み取った結果を確認し、誤りがあれば修正してから確定してください。"
    descriptionStatus={{ label: "確認待ち", tone: "warning" }}
    title="第13回の結果を確認"
  />
);

export const WithMeta = () => (
  <PageHeader
    meta={<StatusBadge label="確定" tone="success" />}
    eyebrow="第12回 桃鉄リーグ"
    title="ももたろうの成績"
  />
);

export const TitleOnly = () => <PageHeader title="プレイヤー一覧" />;
