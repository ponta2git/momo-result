import type { HTMLAttributes, ReactNode } from "react";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function Card({ children, className = "", ...props }: CardProps) {
  return (
    <div
      className={`rounded-[2rem] border border-line-soft bg-night-900/78 p-5 shadow-[0_20px_70px_rgb(0_0_0/0.18)] backdrop-blur ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
