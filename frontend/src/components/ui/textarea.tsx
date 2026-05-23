import * as React from "react";

import { cn } from "./utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-20 w-full rounded-xl px-3.5 py-2 text-sm md:text-sm",
        "bg-black/5 border border-black/8 backdrop-blur-md",
        "text-slate-900 placeholder:text-slate-500",
        "resize-none field-sizing-content",
        "transition-[border-color,background,box-shadow] outline-none",
        "hover:bg-black/8",
        "focus-visible:bg-white focus-visible:border-[var(--accent-cyan)] focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent-cyan)_25%,transparent)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-[var(--accent-destructive)] aria-invalid:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent-destructive)_20%,transparent)]",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
