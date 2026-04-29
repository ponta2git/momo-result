import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger";
};

const variantClasses = {
  primary: "bg-rail-gold text-night-950 shadow-lg shadow-rail-gold/20 hover:bg-yellow-300",
  secondary: "border border-white/15 bg-white/[0.06] text-white hover:bg-white/[0.12]",
  danger: "border border-red-300/40 bg-red-950/50 text-red-50 hover:bg-red-900/60",
};

export function Button({ children, className = "", variant = "primary", ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses[variant]} ${className}`}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}
