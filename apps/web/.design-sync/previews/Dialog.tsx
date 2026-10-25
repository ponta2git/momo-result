import { Button, Dialog, DialogFooter } from "momo-result-ui";

export const Open = () => (
  <Dialog
    description="第12回 桃鉄リーグ・3年決戦の結果を確定します。確定後も管理者は修正できます。"
    footer={
      <DialogFooter>
        <Button variant="quiet">キャンセル</Button>
        <Button variant="primary">結果を確定</Button>
      </DialogFooter>
    }
    open
    title="試合結果を確定しますか？"
  >
    <ul className="grid gap-1 text-sm">
      <li>1位 ももたろう 12億8,400万円</li>
      <li>2位 きんたろう 9億7,200万円</li>
      <li>3位 うらしま 6億4,850万円</li>
      <li>4位 かぐや 3億1,300万円</li>
    </ul>
  </Dialog>
);
