import * as React from 'react';

import { cn } from './utils';

type GlassSkeletonProps = React.ComponentProps<'div'> & {
  count?: number;
};

function GlassSkeletonBase({ className, count = 1, ...props }: GlassSkeletonProps) {
  if (count <= 1) {
    return <div className={cn('glass-skeleton', className)} {...props} />;
  }
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={cn('glass-skeleton', className)} {...props} />
      ))}
    </>
  );
}

function SkeletonCard({ className, count = 1, ...props }: GlassSkeletonProps) {
  return <GlassSkeletonBase className={cn('h-32 rounded-2xl', className)} count={count} {...props} />;
}

function SkeletonRow({ className, count = 1, ...props }: GlassSkeletonProps) {
  return <GlassSkeletonBase className={cn('h-14 rounded-xl', className)} count={count} {...props} />;
}

function SkeletonText({ className, count = 1, ...props }: GlassSkeletonProps) {
  return <GlassSkeletonBase className={cn('h-4 rounded-md', className)} count={count} {...props} />;
}

export const GlassSkeleton = Object.assign(GlassSkeletonBase, {
  Card: SkeletonCard,
  Row: SkeletonRow,
  Text: SkeletonText,
});
