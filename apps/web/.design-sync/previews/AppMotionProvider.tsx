import { AppMotionProvider, Disclosure, FactList } from "momo-result-ui";

export const WrappingDisclosure = () => (
  <AppMotionProvider>
    <Disclosure defaultOpen panelPadding="sm" presentation="framed" summary="目的地と順位の詳細">
      <FactList
        ariaLabel="目的地到着回数"
        items={[
          { id: "momo", label: "ももたろう", value: "9回" },
          { id: "kin", label: "きんたろう", value: "7回" },
          { id: "ura", label: "うらしま", value: "5回" },
        ]}
        layout="inline"
      />
    </Disclosure>
  </AppMotionProvider>
);

export const WrappingClosed = () => (
  <AppMotionProvider>
    <Disclosure presentation="framed" summary="収益と順位の詳細">
      <p className="text-sm">詳細</p>
    </Disclosure>
  </AppMotionProvider>
);
