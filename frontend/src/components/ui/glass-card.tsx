import * as React from 'react';

import { cn } from './utils';

type GlassCardProps = React.ComponentProps<'div'> & {
  interactive?: boolean;
  strong?: boolean;
  /** Accepted for back-compat; ignored (no animation). */
  animate?: boolean;
};

export const GlassCard = React.forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className, interactive, strong, animate: _animate, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          strong ? 'glass-card-strong' : 'glass-card',
          interactive && 'cursor-pointer',
          'p-6',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);
GlassCard.displayName = 'GlassCard';
