import { Disclosure, FactList } from "momo-result-ui";

const breakdown = [
  { id: "revenue", label: "収益", value: "23,500万円" },
  { id: "assets", label: "総資産", value: "128,400万円" },
  { id: "destinations", label: "目的地到着", value: "9回" },
];

export const FramedOpen = () => (
  <Disclosure defaultOpen panelPadding="sm" presentation="framed" summary="収益と順位の詳細">
    <FactList ariaLabel="ももたろうの内訳" items={breakdown} layout="inline" />
  </Disclosure>
);

export const SupportingClosed = () => (
  <div className="grid gap-1">
    <Disclosure summary="点数の集計に使った記録" triggerVariant="supporting">
      <p className="text-sm">第1回〜第12回の試合結果から集計しています。</p>
    </Disclosure>
    <Disclosure summary="作成元の記録" triggerVariant="supporting">
      <p className="text-sm">2026/10/24 21:05 に管理者が作成しました。</p>
    </Disclosure>
  </div>
);

export const TriggerVariants = () => (
  <div className="grid gap-3">
    <Disclosure presentation="framed" summary="目的地と順位の詳細" triggerVariant="default">
      <p className="text-sm">詳細</p>
    </Disclosure>
    <Disclosure presentation="framed" summary="補足：採点の考え方" triggerVariant="supporting">
      <p className="text-sm">詳細</p>
    </Disclosure>
    <Disclosure
      presentation="framed"
      summary="計算式を表示"
      triggerLayout="compact"
      triggerVariant="compact"
    >
      <p className="text-sm">詳細</p>
    </Disclosure>
  </div>
);

export const Disabled = () => (
  <Disclosure disabled presentation="framed" summary="第13回の詳細（試合結果の登録待ち）">
    <p className="text-sm">まだ記録がありません。</p>
  </Disclosure>
);
