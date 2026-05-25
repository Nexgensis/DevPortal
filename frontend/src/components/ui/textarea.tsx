import * as React from "react";

import { cn } from "./utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-20 w-full rounded-xl px-3.5 py-2 text-sm md:text-sm",
        "bg-[color-mix(in_srgb,var(--ink)_5%,transparent)] border border-[var(--border)] backdrop-blur-md",
        "text-[var(--ink)] placeholder:text-[var(--ink-muted)]",
        "resize-none field-sizing-content",
        "transition-[border-color,background,box-shadow] outline-none",
        "hover:bg-black/8",
        "focus-visible:bg-[var(--card)] focus-visible:border-[var(--accent-cyan)] focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent-cyan)_25%,transparent)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-[var(--accent-destructive)] aria-invalid:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent-destructive)_20%,transparent)]",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
