import { FactList, Skeleton, StaleShield } from "momo-result-ui";

const Summary = () => (
  <FactList
    ariaLabel="第12回の概要"
    columns={2}
    items={[
      { id: "date", label: "開催日", value: "2026/10/24" },
      { id: "years", label: "プレイ年数", value: "30年" },
      { id: "winner", label: "優勝", value: "ももたろう" },
      { id: "assets", label: "優勝者の総資産", value: "128,400万円" },
    ]}
  />
);

const Loading = () => (
  <div className="grid gap-2">
    <Skeleton className="h-4 w-24" />
    <Skeleton className="h-5 w-48" />
    <Skeleton className="h-4 w-24" />
    <Skeleton className="h-5 w-40" />
  </div>
);

export const Settled = () => (
  <StaleShield active={false} fallback={<Loading />}>
    <Summary />
  </StaleShield>
);

export const ReplaceLoading = () => (
  <StaleShield active fallback={<Loading />}>
    <Summary />
  </StaleShield>
);

export const PreserveInert = () => (
  <div>
    <StaleShield
      active
      busyLabel="第13回を読み込み中"
      fallback={<Loading />}
      strategy="preserve-inert"
    >
      <div style={{ paddingTop: "3rem" }}>
        <Summary />
      </div>
    </StaleShield>
  </div>
);

export const PreserveTopEnd = () => (
  <StaleShield
    active
    fallback={<Loading />}
    statusPlacement="top-end"
    strategy="preserve-interactive"
  >
    <div style={{ paddingTop: "2.5rem" }}>
      <Summary />
    </div>
  </StaleShield>
);
