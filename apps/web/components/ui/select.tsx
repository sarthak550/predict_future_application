import * as React from "react";

import { cn } from "@/lib/utils";

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "h-11 w-full rounded-2xl border border-ink-200 bg-white px-4 text-sm text-ink-900 outline-none transition focus:border-signal-sky focus:ring-2 focus:ring-signal-sky/20",
      className
    )}
    {...props}
  />
));

Select.displayName = "Select";
