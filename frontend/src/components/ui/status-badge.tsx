import * as React from 'react';

import { cn } from './utils';

type Status = 'online' | 'offline' | 'running' | 'stopped' | 'idle';

type StatusBadgeProps = {
  status: Status;
  label?: string;
  showDot?: boolean;
  showLabel?: boolean;
  className?: string;
};

const STATUS_TO_TONE: Record<Status, 'online' | 'offline' | 'idle'> = {
  online: 'online',
  running: 'online',
  offline: 'offline',
  stopped: 'offline',
  idle: 'idle',
};

const DEFAULT_LABEL: Record<Status, string> = {
  online: 'Online',
  offline: 'Offline',
  running: 'Running',
  stopped: 'Stopped',
  idle: 'Idle',
};

export function StatusBadge({
  status,
  label,
  showDot = true,
  showLabel = true,
  className,
}: StatusBadgeProps) {
  const tone = STATUS_TO_TONE[status];
  const text = label ?? DEFAULT_LABEL[status];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border',
        tone === 'online' &&
          'bg-[var(--accent-green-soft)] border-[color-mix(in_srgb,var(--accent-green)_30%,transparent)] text-[#3F7A2E]',
        tone === 'offline' &&
          'bg-[var(--accent-destructive-soft)] border-[color-mix(in_srgb,var(--accent-destructive)_25%,transparent)] text-[var(--accent-destructive)]',
        tone === 'idle' && 'bg-[var(--card)] border-[var(--border)] text-[var(--ink-muted)]',
        className,
      )}
    >
      {showDot && (
        <span
          className={cn(
            tone === 'online' && 'status-dot-online',
            tone === 'offline' && 'status-dot-offline',
            tone === 'idle' && 'rounded-full size-2 bg-[var(--ink-muted)]',
          )}
          aria-hidden
        />
      )}
      {showLabel && <span>{text}</span>}
    </span>
  );
}
