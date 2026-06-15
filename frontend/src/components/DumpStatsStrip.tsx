import { useMemo } from 'react';
import { Download, Database, Users, Activity } from 'lucide-react';
import { useDumpStats, DumpStats } from '../hooks/useDumpStats';
import { GlassSkeleton } from './ui/glass-skeleton';

// formatBytes — short human label for byte counts. Matches the one in
// PostgresManager; duplicated here to keep this component self-contained
// (it's the only consumer outside that file).
const formatBytes = (n: number): string => {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
};

// fillTrend pads the backend's sparse daily counts into a dense 30-bucket
// series ending today, so the sparkline always has a consistent x-axis even
// for days with zero dumps.
const fillTrend = (raw: { date: string; count: number }[]): number[] => {
  const map = new Map(raw.map((p) => [p.date, p.count]));
  const out: number[] = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push(map.get(key) ?? 0);
  }
  return out;
};

// Sparkline — inline SVG, no chart library. Filled area + line stroke.
// `containerType: inline-size` lets it stretch to the card width.
const Sparkline = ({ data }: { data: number[] }) => {
  const max = Math.max(1, ...data);
  const w = 100;
  const h = 36;
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const points = data.map((v, i) => {
    const x = i * step;
    const y = h - (v / max) * h;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const linePath = `M ${points.join(' L ')}`;
  const areaPath = `${linePath} L ${w},${h} L 0,${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" width="100%" height="44">
      <path d={areaPath} fill="var(--accent-pink)" opacity="0.14" />
      <path d={linePath} fill="none" stroke="var(--accent-pink)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

// Single stat card chrome — flat bento card with an icon chip header.
const StatCard = ({ icon: Icon, label, children }: { icon: typeof Download; label: string; children: React.ReactNode }) => (
  <div className="bento-card p-5 flex flex-col gap-3">
    <div className="flex items-center gap-2">
      <div className="h-7 w-7 rounded-lg bg-[var(--accent-pink-soft)] flex items-center justify-center shrink-0">
        <Icon className="h-3.5 w-3.5 text-[var(--accent-pink)]" />
      </div>
      <span className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">{label}</span>
    </div>
    {children}
  </div>
);

const EmptyHint = ({ children }: { children: React.ReactNode }) => (
  <p className="text-xs text-[var(--ink-muted)] italic">{children}</p>
);

const RankedList = ({ items }: { items: { primary: string; count: number }[] }) => {
  if (items.length === 0) return <EmptyHint>No dumps yet in the last 30 days.</EmptyHint>;
  const top = items[0]?.count || 1;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((it, idx) => (
        <li key={idx} className="flex items-center gap-2 text-sm">
          <span className="tabular-nums text-[var(--ink-muted)] w-4 text-right text-xs">{idx + 1}</span>
          <div className="flex-1 min-w-0 relative">
            {/* subtle bar behind the label scaled to share-of-top */}
            <div
              aria-hidden
              className="absolute inset-y-0 left-0 rounded"
              style={{
                width: `${Math.max(8, (it.count / top) * 100)}%`,
                background: 'var(--accent-pink-soft)',
                opacity: 0.55,
              }}
            />
            <span className="relative truncate block text-[var(--ink)] font-medium px-1.5 py-0.5" title={it.primary}>
              {it.primary}
            </span>
          </div>
          <span className="tabular-nums text-xs font-semibold text-[var(--ink)] shrink-0">{it.count}</span>
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

export const DumpStatsStrip = ({ stats, loading }: { stats: DumpStats | null; loading?: boolean }) => {
  const trendSeries = useMemo(() => fillTrend(stats?.trend || []), [stats?.trend]);
  const totalTrend = trendSeries.reduce((s, v) => s + v, 0);

  if (loading && !stats) return <Skeleton />;
  if (!stats) return null; // silently hide on error rather than show a broken strip

  const dbs = stats.mostDumpedDatabases.map((d) => ({ primary: d.database, count: d.count }));
  const users = stats.topUsers.map((u) => ({ primary: u.username, count: u.count }));

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Total this month */}
      <StatCard icon={Download} label="This month">
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-bold tabular-nums text-[var(--ink)] leading-none">
            {stats.totalThisMonth.count}
          </span>
          <span className="text-xs text-[var(--ink-muted)]">
            dump{stats.totalThisMonth.count === 1 ? '' : 's'}
          </span>
        </div>
        <p className="text-sm text-[var(--ink-muted)] mt-auto">
          {stats.totalThisMonth.sizeBytes > 0
            ? <>Total size <span className="font-semibold text-[var(--ink)]">{formatBytes(stats.totalThisMonth.sizeBytes)}</span></>
            : <span className="italic">Size tracking starts now</span>}
        </p>
      </StatCard>

      {/* Most-dumped databases */}
      <StatCard icon={Database} label="Most dumped">
        <RankedList items={dbs.slice(0, 4)} />
      </StatCard>

      {/* Top users */}
      <StatCard icon={Users} label="Top users">
        <RankedList items={users.slice(0, 4)} />
      </StatCard>

      {/* Trend sparkline */}
      <StatCard icon={Activity} label="Trend · 30d">
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-bold tabular-nums text-[var(--ink)] leading-none">{totalTrend}</span>
          <span className="text-xs text-[var(--ink-muted)]">dumps</span>
        </div>
        <div className="mt-auto">
          {totalTrend > 0
            ? <Sparkline data={trendSeries} />
            : <EmptyHint>No activity in the last 30 days.</EmptyHint>}
        </div>
      </StatCard>
    </div>
  );
};
