import { AlertDialog } from "momo-result-ui";

export const Danger = () => (
  <AlertDialog
    confirmLabel="開催を削除"
    description="第12回 桃鉄リーグと、ひもづく 3 試合の結果を削除します。この操作は取り消せません。"
    onConfirm={() => undefined}
    open
    title="開催を削除しますか？"
  />
);
