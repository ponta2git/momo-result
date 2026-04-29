import type { HTMLAttributes, ReactNode } from "react";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function Card({ children, className = "", ...props }: CardProps) {
  return (
    <div
      className={`rounded-[2rem] border border-white/10 bg-night-900/72 p-5 shadow-2xl shadow-black/30 backdrop-blur ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
