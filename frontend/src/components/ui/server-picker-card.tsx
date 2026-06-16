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
  fill: string;      // flat solid color for the left accent panel
  dot: string;       // status dot color (pops on the fill)
  glow: string;      // hover glow color tint
  tint: string;      // flat pale wash for the right stats panel (coordinates both halves)
  accent: string;    // saturated status color for the stat icon chips
  icon: LucideIcon;
}

// Flat solid panels (white text) — no gradients. The left panel is one clean
// status color, the right stats panel a pale wash of the same hue.
const STATUS_TONE: Record<ServerPickerStatus, StatusTone> = {
  online: {
    // Teal — a different brand hue from the indigo project/database cards so a
    // server tile stands on its own. (Nexus scan-teal.)
    label: 'Online',
    fill: '#0f9d9d',
    dot: '#eafffb',                      // bright mint dot, pops on teal
    glow: 'rgba(15,157,157,0.20)',
    tint: '#e9f6f5',
    accent: '#0f9d9d',
    icon: Activity,
  },
  offline: {
    label: 'Offline',
    fill: '#f0455c',                     // coral/red
    dot: '#ffffff',
    glow: 'rgba(240,69,92,0.18)',
    tint: '#ffeceb',
    accent: '#e8384f',
    icon: CircleOff,
  },
  checking: {
    label: 'Checking',
    fill: '#f59e0b',                     // amber
    dot: '#ffffff',
    glow: 'rgba(245,158,11,0.18)',
    tint: '#fdf3e0',
    accent: '#d97706',
    icon: Clock,
  },
  idle: {
    label: 'Idle',
    fill: '#64748b',                     // slate
    dot: '#ffffff',
    glow: 'rgba(100,116,139,0.16)',
    tint: '#eef1f5',
    accent: '#64748b',
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
      className="lift group block w-full text-left rounded-[28px] p-2 border border-[var(--border)] bg-[var(--card)] hover:-translate-y-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-pink)] focus-visible:ring-offset-2"
      style={{ ['--lift-glow' as never]: `0 16px 36px ${tone.glow}` }}
      aria-label={`${name} server (${tone.label})`}
    >
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
        {/* Accent panel — saturated gradient, focal server name + address. The
            name uses cqw clamp + containerType so it scales gracefully with the
            card width: bigger on wider cards, never overflowing on narrow. */}
        <div
          className="relative sm:col-span-3 rounded-[18px] px-4 py-4 flex flex-col overflow-hidden text-white"
          style={{
            background: tone.fill,
            minHeight: '160px',
            containerType: 'inline-size',
          }}
        >
          <div className="relative flex items-center gap-1.5 text-[11px] font-semibold">
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: tone.dot, boxShadow: `0 0 0 3px color-mix(in srgb, ${tone.dot} 30%, transparent)` }}
            />
            <Icon className="h-3 w-3" strokeWidth={2.5} />
            <span className="uppercase tracking-wider">{tone.label}</span>
          </div>

          <div className="relative mt-auto">
            {/* BIG focal server name — scales with container width using cqw. */}
            <div
              className="font-bold tracking-tight break-all line-clamp-2"
              style={{
                fontSize: 'clamp(24px, 10cqw, 40px)',
                lineHeight: 1.02,
                letterSpacing: '-0.02em',
              }}
            >
              {name}
            </div>
            {/* Host address — scales similarly but capped lower. */}
            <div
              className="truncate font-medium font-mono tabular-nums mt-1.5"
              style={{
                color: 'rgba(255,255,255,0.72)',
                fontSize: 'clamp(11px, 3cqw, 14px)',
                letterSpacing: '-0.01em',
              }}
            >
              {address}
            </div>
          </div>
        </div>

        {/* Stats panel — softly tinted with the status color so both halves of
            the card read as one tile (not a colored block next to plain gray). */}
        <div
          className="sm:col-span-2 rounded-[18px] px-3.5 py-3.5 flex flex-col"
          style={{ background: tone.tint, color: 'var(--ink)', minHeight: '160px' }}
        >
          <div className="flex flex-col gap-2">
            <StatRow icon={Box}        value={fmt(stats?.containers)}   label="Containers"    accent={tone.accent} />
            <StatRow icon={FileCode2}  value={fmt(stats?.composeFiles)} label="Compose files" accent={tone.accent} />
            <StatRow icon={Layers}     value={fmt(stats?.projects)}     label="Projects"      accent={tone.accent} />
          </div>
          <div className="mt-auto pt-2 flex items-center justify-end gap-1 text-[11px] font-medium text-[var(--ink-muted)] group-hover:text-[var(--ink)]">
            <ServerIcon className="h-3 w-3" strokeWidth={2} />
            <span>Open</span>
            <ChevronRight className="h-3 w-3" strokeWidth={2} />
          </div>
        </div>
      </div>
    </button>
  );
};

// StatRow — single stat line on the light panel: icon chip + big number + label.
// Big number sits as the focal element; label is a subtler one-liner below.
const StatRow = ({ icon: Icon, value, label, accent }: { icon: LucideIcon; value: string; label: string; accent: string }) => (
  <div className="flex items-center gap-2.5 min-w-0">
    <div
      className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0 bg-[var(--card)]"
      style={{ border: `1px solid color-mix(in srgb, ${accent} 30%, var(--border))` }}
    >
      <Icon className="h-3 w-3" strokeWidth={2} style={{ color: accent }} />
    </div>
    <div className="min-w-0 flex-1">
      <div className="text-[15px] font-bold leading-none tabular-nums text-[var(--ink)]">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--ink-muted)] mt-0.5 truncate">{label}</div>
    </div>
  </div>
);
