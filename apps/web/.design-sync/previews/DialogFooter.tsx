import { Button, Dialog, DialogFooter } from "momo-result-ui";

export const InDialog = () => (
  <Dialog
    description="比べる相手の目的地到着回数を仮に変えて、見通しを確認します。"
    open
    title="到着回数を設定"
  >
    <div className="grid gap-4">
      <p className="text-sm">きんたろう：目的地 7 回 → 9 回</p>
      <DialogFooter>
        <Button variant="quiet">キャンセル</Button>
        <Button variant="primary">この回数を使う</Button>
      </DialogFooter>
    </div>
  </Dialog>
);
