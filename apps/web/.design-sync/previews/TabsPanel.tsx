import { Notice, TabsList, TabsPanel, TabsRoot, TabsTab, TextField } from "momo-result-ui";

export const FormPanel = () => (
  <div className="max-w-md">
    <TabsRoot defaultValue="momotaro">
      <TabsList aria-label="入力するプレイヤー" variant="underline">
        <TabsTab value="momotaro">ももたろう</TabsTab>
        <TabsTab value="kintaro">きんたろう</TabsTab>
        <TabsTab value="urashima">うらしま</TabsTab>
      </TabsList>
      <TabsPanel value="momotaro">
        <div className="mt-4 grid grid-cols-2 gap-4">
          <TextField defaultValue="128400" label="総資産（万円）" textAlign="end" />
          <TextField defaultValue="23500" label="収益（万円）" textAlign="end" />
        </div>
      </TabsPanel>
    </TabsRoot>
  </div>
);

export const NoticePanel = () => (
  <div className="max-w-md">
    <TabsRoot defaultValue="recalculation">
      <TabsList aria-label="戦績分析管理の表示切替">
        <TabsTab value="recalculation">分析の再計算</TabsTab>
        <TabsTab value="radar">レーダーの採点基準</TabsTab>
      </TabsList>
      <TabsPanel value="recalculation">
        <div className="mt-4">
          <Notice title="追加の再計算が予約されています" tone="info">
            2件・最古 2026/10/24 21:05
          </Notice>
        </div>
      </TabsPanel>
    </TabsRoot>
  </div>
);
