import * as React from 'react';

import { cn } from './utils';

// Note: legacy variant names ('lime' / 'cyan') are kept as aliases so call sites
// across the dashboard keep working — they map to 'pink' on the warm palette.
type AccentVariant = 'pink' | 'ghost' | 'destructive' | 'lime' | 'cyan';
type AccentSize = 'sm' | 'md' | 'lg';

type AccentButtonProps = Omit<React.ComponentProps<'button'>, 'ref'> & {
  variant?: AccentVariant;
  size?: AccentSize;
  loading?: boolean;
};

const PRIMARY = 'bg-[var(--accent-pink)] text-[var(--on-accent)] hover:brightness-95 border border-transparent';
const VARIANT: Record<AccentVariant, string> = {
  pink: PRIMARY,
  ghost:
    'bg-[var(--card)] text-[var(--ink)] hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] border border-[var(--border)]',
  destructive:
    'bg-[var(--accent-destructive)] text-[var(--on-accent)] hover:brightness-95 border border-transparent',
  // legacy aliases → primary
  lime: PRIMARY,
  cyan: PRIMARY,
};

const SIZE: Record<AccentSize, string> = {
  sm: 'h-8 px-3 text-sm rounded-lg',
  md: 'h-10 px-4 text-sm rounded-xl',
  lg: 'h-11 px-6 text-base rounded-xl',
};

export const AccentButton = React.forwardRef<HTMLButtonElement, AccentButtonProps>(
  ({ className, variant = 'pink', size = 'md', loading, disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          'inline-flex items-center justify-center gap-2 font-medium transition-colors',
          'focus-ring-cyan disabled:opacity-60 disabled:cursor-not-allowed',
          'active:scale-[0.98]',
          '[&_svg]:size-4 [&_svg]:shrink-0',
          VARIANT[variant],
          SIZE[size],
          className,
        )}
        {...props}
      >
        {loading && (
          <span
            className="inline-block size-4 rounded-full border-2 border-current border-r-transparent animate-spin"
            aria-hidden
          />
        )}
        {children}
      </button>
    );
  },
);
AccentButton.displayName = 'AccentButton';
