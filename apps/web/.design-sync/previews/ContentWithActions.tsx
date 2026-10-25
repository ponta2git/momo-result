import { Pencil, Trash2 } from "lucide-react";
import { Button, ContentWithActions, IconButton, StatusBadge, contentText } from "momo-result-ui";

export const MatchRow = () => (
  <ContentWithActions
    actions={
      <>
        <Button size="sm" variant="secondary" icon={<Pencil aria-hidden="true" />}>
          編集
        </Button>
        <Button size="sm" variant="dangerQuiet" icon={<Trash2 aria-hidden="true" />}>
          削除
        </Button>
      </>
    }
  >
    <p className={contentText.heading}>第12回 桃鉄リーグ</p>
    <p className={contentText.supporting}>2026/10/24・30年・優勝 ももたろう</p>
  </ContentWithActions>
);

export const WithStatus = () => (
  <ContentWithActions
    actions={
      <>
        <StatusBadge label="下書き" tone="warning" />
        <IconButton aria-label="編集" icon={<Pencil />} size="sm" tooltip="編集" />
      </>
    }
  >
    <p className={contentText.heading}>第13回 桃鉄リーグ</p>
    <p className={contentText.supporting}>結果の読み取りが完了していません。</p>
  </ContentWithActions>
);

export const NarrowWraps = () => (
  <div className="max-w-72">
    <ContentWithActions
      actions={
        <Button size="sm" variant="secondary">
          結果を確認
        </Button>
      }
    >
      <p className={contentText.heading}>第11回 桃鉄リーグ（100年プレイ）</p>
      <p className={contentText.supporting}>幅が足りないと操作は本文の下へ回り込みます。</p>
    </ContentWithActions>
  </div>
);

export const ContentOnly = () => (
  <ContentWithActions>
    <p className={contentText.heading}>第10回 桃鉄リーグ</p>
    <p className={contentText.supporting}>閲覧のみ・操作はありません。</p>
  </ContentWithActions>
);
