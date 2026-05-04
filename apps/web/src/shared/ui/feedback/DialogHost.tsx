import type { ReactNode } from "react";

type DialogHostProps = {
  children: ReactNode;
};

export function DialogHost({ children }: DialogHostProps) {
  return children;
}
