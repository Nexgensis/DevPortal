import { MemoryStick, Cpu, Boxes, Server } from 'lucide-react';
import { useFleetResources, ContainerResource, ServerLoad } from '../hooks/useFleetResources';
import { GlassSkeleton } from './ui/glass-skeleton';

// formatBytes — short human label for byte counts.
const formatBytes = (n: number): string => {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
};

// One stat card — flat bento chrome with a colored icon chip header. `accent`
// is the per-card hue so the strip reads as a richer dashboard than one flat color.
const StatCard = ({
  icon: Icon,
  label,
  accent,
  children,
}: {
  icon: typeof Cpu;
  label: string;
  accent: string;
  children: React.ReactNode;
}) => (
  <div className="bento-card p-5 flex flex-col gap-3 min-h-[180px]">
    <div className="flex items-center gap-2">
      <div
        className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: `color-mix(in srgb, ${accent} 14%, transparent)` }}
      >
        <Icon className="h-3.5 w-3.5" style={{ color: accent }} />
      </div>
      <span className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">{label}</span>
    </div>
    {children}
  </div>
);

// Ranked container list (top RAM or top CPU) — rank, name + server, value, and a
// subtle bar scaled to share-of-leader.
const ResourceList = ({
  items,
  kind,
  accent,
}: {
  items: ContainerResource[];
  kind: 'cpu' | 'mem';
  accent: string;
}) => {
  if (items.length === 0) {
    return <p className="text-xs text-[var(--ink-muted)] italic">No running containers found.</p>;
  }
  const valOf = (r: ContainerResource) => (kind === 'cpu' ? r.cpuPct : r.memBytes);
  const fmtOf = (r: ContainerResource) => (kind === 'cpu' ? `${r.cpuPct.toFixed(1)}%` : formatBytes(r.memBytes));
  const top = Math.max(1, ...items.map(valOf));
  return (
    <ul className="flex flex-col gap-2">
      {items.slice(0, 4).map((r, idx) => (
        <li key={`${r.server}-${r.name}-${idx}`} className="flex items-center gap-2 text-sm">
          <span className="tabular-nums text-[var(--ink-muted)] w-4 text-right text-xs">{idx + 1}</span>
          <div className="flex-1 min-w-0 relative">
            <div
              aria-hidden
              className="absolute inset-y-0 left-0 rounded"
              style={{ width: `${Math.max(8, (valOf(r) / top) * 100)}%`, background: `color-mix(in srgb, ${accent} 16%, transparent)` }}
            />
            <div className="relative px-1.5 py-0.5 min-w-0">
              <span className="truncate block text-[var(--ink)] font-medium leading-tight" title={`${r.name} · ${r.server}`}>
                {r.name}
              </span>
              <span className="truncate block text-[10px] text-[var(--ink-muted)] uppercase tracking-wider leading-tight">
                {r.server}
              </span>
            </div>
          </div>
          <span className="tabular-nums text-xs font-bold text-[var(--ink)] shrink-0">{fmtOf(r)}</span>
        </li>
      ))}
    </ul>
  );
};

// Per-server load rows with a memory bar scaled across servers.
const ServerLoadList = ({ servers, accent }: { servers: ServerLoad[]; accent: string }) => {
  const online = servers.filter((s) => s.online);
  if (online.length === 0) {
    return <p className="text-xs text-[var(--ink-muted)] italic mt-auto">No online servers.</p>;
  }
  const top = Math.max(1, ...online.map((s) => s.memBytes));
  return (
    <ul className="flex flex-col gap-2.5 mt-1">
      {online.map((s) => (
        <li key={s.server} className="min-w-0">
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <span className="text-sm font-semibold text-[var(--ink)] truncate">{s.server}</span>
            <span className="text-[11px] tabular-nums text-[var(--ink-muted)] shrink-0">
              {s.containers} · {formatBytes(s.memBytes)} · {s.cpuPct.toFixed(0)}%
            </span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'color-mix(in srgb, var(--ink) 6%, transparent)' }}>
            <div className="h-full rounded-full" style={{ width: `${Math.max(4, (s.memBytes / top) * 100)}%`, background: accent }} />
          </div>
        </li>
      ))}
    </ul>
  );
};

const Skeleton = () => (
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
    {[0, 1, 2, 3].map((i) => (
      <div key={i} className="bento-card p-5 h-[180px]">
        <GlassSkeleton className="h-full w-full" />
      </div>
    ))}
  </div>
);

const ACCENT = {
  ram: '#5B4DFF',   // violet
  cpu: '#FF5A5F',   // coral
  mem: '#0F9D9D',   // teal
  load: '#10B981',  // green
};

export const FleetInsights = () => {
  // Self-fetching: mounting this (only on the Running Apps landing) starts the
  // poll; unmounting it (when a server is drilled into) stops the fleet gather.
  const { data } = useFleetResources();

  // First load (cold cache) — the gather is still running.
  if (!data || (data.computing && data.containers === 0)) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
          <span className="h-3.5 w-3.5 rounded-full border-2 border-[var(--accent-pink)] border-r-transparent animate-spin" />
          Gathering live CPU &amp; memory across the fleet…
        </div>
        <Skeleton />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Top RAM consumers */}
      <StatCard icon={MemoryStick} label="Top RAM" accent={ACCENT.ram}>
        <ResourceList items={data.topMem} kind="mem" accent={ACCENT.ram} />
      </StatCard>

      {/* Top CPU consumers */}
      <StatCard icon={Cpu} label="Top CPU" accent={ACCENT.cpu}>
        <ResourceList items={data.topCpu} kind="cpu" accent={ACCENT.cpu} />
      </StatCard>

      {/* Fleet memory total */}
      <StatCard icon={Boxes} label="Fleet memory" accent={ACCENT.mem}>
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-bold tabular-nums text-[var(--ink)] leading-none">
            {formatBytes(data.totalMem).split(' ')[0]}
          </span>
          <span className="text-sm text-[var(--ink-muted)]">{formatBytes(data.totalMem).split(' ')[1]} used</span>
        </div>
        <p className="text-sm text-[var(--ink-muted)] mt-auto">
          across <span className="font-semibold text-[var(--ink)]">{data.containers}</span> running container{data.containers === 1 ? '' : 's'}
          {' · '}
          <span className="font-semibold text-[var(--ink)]">{data.totalCpu.toFixed(0)}%</span> CPU
        </p>
      </StatCard>

      {/* Per-server load */}
      <StatCard icon={Server} label="Per server" accent={ACCENT.load}>
        <ServerLoadList servers={data.servers} accent={ACCENT.load} />
      </StatCard>
    </div>
  );
};
