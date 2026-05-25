import * as React from "react";

import { cn } from "./utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-10 w-full min-w-0 rounded-xl px-3.5 py-1.5 text-sm md:text-sm",
        "bg-[color-mix(in_srgb,var(--ink)_5%,transparent)] border border-[var(--border)]",
        "text-[var(--ink)] placeholder:text-[var(--ink-muted)]",
        "transition-[border-color,background,box-shadow] outline-none",
        "hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)]",
        "focus-visible:bg-[var(--card)] focus-visible:border-[var(--accent-pink)] focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent-pink)_25%,transparent)]",
        "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-[var(--ink)]",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-[var(--accent-destructive)] aria-invalid:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent-destructive)_20%,transparent)]",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
