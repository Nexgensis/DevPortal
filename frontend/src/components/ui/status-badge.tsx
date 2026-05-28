import * as React from 'react';
import { Activity, CircleOff, Clock } from 'lucide-react';
import { PillTag, PillTone } from './pill-tag';

type Status = 'online' | 'offline' | 'running' | 'stopped' | 'idle';

type StatusBadgeProps = {
  status: Status;
  label?: string;
  /** Kept for API compatibility — `false` hides the icon chip. */
  showDot?: boolean;
  showLabel?: boolean;
  className?: string;
};

// Map each status to a PillTag tone + a small icon. Running/online share green
// (live), stopped/offline share red (terminated), idle is a neutral slate.
const STATUS_TONE: Record<Status, PillTone> = {
  online: 'green',
  running: 'green',
  offline: 'red',
  stopped: 'red',
  idle: 'slate',
};

const STATUS_ICON = {
  online: Activity,
  running: Activity,
  offline: CircleOff,
  stopped: CircleOff,
  idle: Clock,
} as const;

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
  const text = label ?? DEFAULT_LABEL[status];
  const Icon = STATUS_ICON[status];

  return (
    <PillTag
      tone={STATUS_TONE[status]}
      icon={showDot ? Icon : undefined}
      size="sm"
      className={className}
    >
      {showLabel ? text : ''}
    </PillTag>
  );
}
