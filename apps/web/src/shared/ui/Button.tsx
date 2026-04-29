import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger";
};

const variantClasses = {
  primary:
    "border border-rail-gold/70 bg-rail-gold text-night-950 shadow-[0_8px_24px_rgb(234_193_91/0.16)] hover:bg-paper-100 active:bg-rail-gold/90",
  secondary:
    "border border-line-soft bg-night-800/80 text-ink-100 hover:border-white/18 hover:bg-night-700/80 active:bg-night-800",
  danger:
    "border border-red-300/35 bg-red-950/42 text-red-50 hover:border-red-200/50 hover:bg-red-900/55",
};

export function Button({ children, className = "", variant = "primary", ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-bold transition duration-150 disabled:cursor-not-allowed disabled:opacity-45 ${variantClasses[variant]} ${className}`}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}
