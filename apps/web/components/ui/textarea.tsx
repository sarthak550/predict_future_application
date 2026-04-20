import * as React from "react";

import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "min-h-[120px] w-full rounded-3xl border border-ink-200 bg-white px-4 py-3 text-sm text-ink-900 outline-none transition placeholder:text-ink-400 focus:border-signal-sky focus:ring-2 focus:ring-signal-sky/20",
        className
      )}
      {...props}
    />
  )
);

Textarea.displayName = "Textarea";
