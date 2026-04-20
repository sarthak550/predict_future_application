import * as React from "react";

import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-11 w-full rounded-2xl border border-ink-200 bg-white px-4 text-sm text-ink-900 outline-none transition placeholder:text-ink-400 focus:border-signal-sky focus:ring-2 focus:ring-signal-sky/20",
      className
    )}
    {...props}
  />
));

Input.displayName = "Input";
