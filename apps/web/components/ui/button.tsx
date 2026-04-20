"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = {
  primary:
    "bg-ink-900 text-white hover:bg-ink-700 disabled:bg-ink-400 dark:bg-white dark:text-ink-900",
  secondary:
    "border border-ink-200 bg-white text-ink-900 hover:border-signal-sky hover:text-signal-sky",
  ghost: "text-ink-700 hover:bg-ink-100 hover:text-ink-900",
  danger: "bg-rose-600 text-white hover:bg-rose-500"
} as const;

const buttonSizes = {
  sm: "h-9 rounded-xl px-3 text-sm",
  md: "h-11 rounded-2xl px-4 text-sm",
  lg: "h-12 rounded-2xl px-5 text-base"
} as const;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof buttonVariants;
  size?: keyof typeof buttonSizes;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-medium transition focus:outline-none focus:ring-2 focus:ring-signal-sky focus:ring-offset-2 disabled:cursor-not-allowed",
        buttonVariants[variant],
        buttonSizes[size],
        className
      )}
      {...props}
    />
  )
);

Button.displayName = "Button";
