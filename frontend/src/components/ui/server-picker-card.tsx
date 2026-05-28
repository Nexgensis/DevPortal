import { ChevronRight, Activity, CircleOff, Clock, Server as ServerIcon, Box, FileCode2, Layers } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// ServerPickerCard renders one server in the Database Dump / Running Apps
// picker grids using a two-panel "weather widget" layout: a status-tinted
// accent panel on the left (icon + status label + BIG server name + address)
// next to a dark stats strip on the right (containers / compose files /
// projects). Palette is tuned to the Nexus Aura brand (brand violet for
// online, coral for offline). Stacks vertically below the sm breakpoint.

export type ServerPickerStatus = 'online' | 'offline' | 'checking' | 'idle';

interface StatusTone {
  label: string;
  bg: string;        // pale tint for the left accent panel
  ink: string;       // primary text color (dark on the pale tint)
  subtle: string;    // muted text color (e.g. for the host address)
  accent: string;    // saturated brand accent for the status icon + dot
  glowRing: string;  // unused (kept for type stability)
  icon: LucideIcon;
}

const STATUS_TONE: Record<ServerPickerStatus, StatusTone> = {
  online: {
    label: 'Online',
    bg: '#EEEBFF',                       // pale violet
    ink: '#1A1A1E',
    subtle: 'rgba(26,26,30,0.55)',
    accent: 'var(--accent-pink)',        // saturated violet for the status icon + dot
    glowRing: '',                        // unused (kept for type stability)
    icon: Activity,
  },
  offline: {
    label: 'Offline',
    bg: '#FEE4E5',                       // pale coral
    ink: '#1A1A1E',
    subtle: 'rgba(26,26,30,0.55)',
    accent: 'var(--accent-destructive)',
    glowRing: '',
    icon: CircleOff,
  },
  checking: {
    label: 'Checking',
    bg: '#FEF3C7',                       // pale amber
    ink: '#3a2606',
    subtle: 'rgba(58,38,6,0.65)',
    accent: '#D97706',
    glowRing: '',
    icon: Clock,
  },
  idle: {
    label: 'Idle',
    bg: '#F1F5F9',                       // pale slate
    ink: '#1A1A1E',
    subtle: 'rgba(26,26,30,0.55)',
    accent: '#64748B',
    glowRing: '',
    icon: Clock,
  },
};

export interface ServerPickerCardProps {
  name: string;
  address: string;
  status: ServerPickerStatus;
  onClick: () => void;
  /** Optional server-level stats. While unfetched, the right panel shows muted
   *  placeholders instead of jumping numbers in. */
  stats?: {
    containers?: number;
    composeFiles?: number;
    projects?: number;
  };
}

export const ServerPickerCard = ({ name, address, status, onClick, stats }: ServerPickerCardProps) => {
  const tone = STATUS_TONE[status];
  const Icon = tone.icon;
  const fmt = (n?: number) => (typeof n === 'number' ? n.toLocaleString() : '—');

  return (
    <button
      type="button"
      onClick={onClick}
      className="group block w-full text-left rounded-[28px] p-2 border border-[var(--border)] bg-[var(--card)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-pink)] focus-visible:ring-offset-2"
      aria-label={`${name} server (${tone.label})`}
    >
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
        {/* Accent panel — status colour, focal server name + address. The name
            uses cqw clamp + containerType so it scales gracefully with the
            card width: bigger on wider cards, never overflowing on narrow. */}
        <div
          className="relative sm:col-span-3 rounded-[20px] px-6 py-6 flex flex-col overflow-hidden"
          style={{
            background: tone.bg,
            color: tone.ink,
            minHeight: '210px',
            containerType: 'inline-size',
          }}
        >
          <div className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: tone.accent }}>
            <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: tone.accent }} />
            <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
            <span className="uppercase tracking-wider">{tone.label}</span>
          </div>

          <div className="mt-auto">
            {/* BIG focal server name — scales with container width using cqw. */}
            <div
              className="font-bold tracking-tight break-all line-clamp-2"
              style={{
                fontSize: 'clamp(36px, 12cqw, 64px)',
                lineHeight: 0.98,
                letterSpacing: '-0.02em',
              }}
            >
              {name}
            </div>
            {/* Larger host address — scales similarly but capped lower. */}
            <div
              className="truncate font-medium font-mono tabular-nums mt-2"
              style={{
                color: tone.subtle,
                fontSize: 'clamp(13px, 3.5cqw, 18px)',
                letterSpacing: '-0.01em',
              }}
            >
              {address}
            </div>
          </div>
        </div>

        {/* Light stats panel — three big numbers + uppercase labels, footer open hint. */}
        <div
          className="sm:col-span-2 rounded-[20px] px-5 py-5 flex flex-col"
          style={{ background: 'var(--canvas-soft)', color: 'var(--ink)', minHeight: '210px' }}
        >
          <div className="flex flex-col gap-3">
            <StatRow icon={Box}        value={fmt(stats?.containers)}   label="Containers" />
            <StatRow icon={FileCode2}  value={fmt(stats?.composeFiles)} label="Compose files" />
            <StatRow icon={Layers}     value={fmt(stats?.projects)}     label="Projects" />
          </div>
          <div className="mt-auto pt-3 flex items-center justify-end gap-1 text-[12px] font-medium text-[var(--ink-muted)] group-hover:text-[var(--ink)]">
            <ServerIcon className="h-3.5 w-3.5" strokeWidth={2} />
            <span>Open</span>
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
          </div>
        </div>
      </div>
    </button>
  );
};

// StatRow — single stat line on the light panel: icon chip + big number + label.
// Big number sits as the focal element; label is a subtler one-liner below.
const StatRow = ({ icon: Icon, value, label }: { icon: LucideIcon; value: string; label: string }) => (
  <div className="flex items-center gap-3 min-w-0">
    <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0 bg-[var(--card)] border border-[var(--border)]">
      <Icon className="h-3.5 w-3.5 text-[var(--ink-muted)]" strokeWidth={2} />
    </div>
    <div className="min-w-0 flex-1">
      <div className="text-[18px] font-bold leading-none tabular-nums text-[var(--ink)]">{value}</div>
      <div className="text-[10.5px] uppercase tracking-wider text-[var(--ink-muted)] mt-0.5 truncate">{label}</div>
    </div>
  </div>
);
