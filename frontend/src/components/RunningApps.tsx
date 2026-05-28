import { useEffect, useMemo, useState } from 'react';
import { useServers } from '../hooks/useServers';
import { useServerStats } from '../hooks/useServerStats';
import { useRunningApps } from '../hooks/useRunningApps';
import { useAuth } from '../hooks/useAuth';
import { ProjectGroup, ContainerView } from '../types/runningapps';
import { Rocket, Server, ChevronRight, ChevronLeft, ChevronDown, ExternalLink, FolderKanban, AlertTriangle, Copy, Check, RefreshCw, Pin, Globe, Layers, Container as ContainerIcon, FileCode2 } from 'lucide-react';
import { GlassCard } from './ui/glass-card';
import { AccentButton } from './ui/accent-button';
import { StatusBadge } from './ui/status-badge';
import { GlassSkeleton } from './ui/glass-skeleton';
import { PillTag } from './ui/pill-tag';
import { ServerPickerCard } from './ui/server-picker-card';
import { useTheme } from '../hooks/useTheme';

// One-line copy-paste deploy command for the helper agent. Shown inline when a
// server reports agentMissing so admins can paste-and-run on the host.
const AGENT_DEPLOY_CMD = `docker run -d --name webmanager-agent --restart unless-stopped \\
  --label webmanager.agent=true \\
  -v /etc/nginx/conf.d:/etc/nginx/conf.d:ro \\
  alpine:3 sleep infinity`;

// rootGroupOf extracts the first segment under "/root/" — the user's mental
// grouping (e.g. "qms" from "/root/qms/qms-revamp_2"). Falls back to the first
// path segment or "other" so containers never disappear.
const rootGroupOf = (workingDir: string): string => {
  if (!workingDir) return 'other';
  const m = workingDir.match(/^\/root\/([^/]+)/);
  if (m) return m[1];
  const seg = workingDir.split('/').filter(Boolean)[0];
  return seg || 'other';
};

// Soft pastel gradients — same hash assigns one to each group for stability.
// Designed to read well on the light cream theme (matches the design reference).
const CARD_GRADIENTS: string[] = [
  'linear-gradient(135deg, #FFE0AC 0%, #FFB8D6 45%, #C9B6FF 100%)', // yellow → pink → lavender
  'linear-gradient(135deg, #A8E6FF 0%, #C7D6FF 50%, #E6BFFF 100%)', // sky → blue → mauve
  'linear-gradient(135deg, #B8F0D9 0%, #B6E5FF 50%, #D8C8FF 100%)', // mint → cyan → lilac
  'linear-gradient(135deg, #FFD89B 0%, #FFB6C1 50%, #FF9CC9 100%)', // peach → rose → pink
  'linear-gradient(135deg, #C9B6FF 0%, #FFB8D6 50%, #FFD89B 100%)', // lavender → pink → peach
  'linear-gradient(135deg, #FFB37E 0%, #FFB8D6 50%, #C9B6FF 100%)', // coral → pink → lavender
];
const hashIndex = (s: string, mod: number): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1_000_003;
  return Math.abs(h) % mod;
};

interface RootGroup {
  name: string;
  projects: ProjectGroup[];
  containerCount: number;
  frontendCount: number; // containers with at least one published port
  pinned: boolean;
}

const buildRootGroups = (projects: ProjectGroup[], pinnedSet: Set<string>): RootGroup[] => {
  const map: Record<string, RootGroup> = {};
  for (const p of projects) {
    const key = rootGroupOf(p.workingDir);
    const g = map[key] || { name: key, projects: [], containerCount: 0, frontendCount: 0, pinned: pinnedSet.has(key) };
    g.projects.push(p);
    for (const c of p.containers) {
      g.containerCount += 1;
      if ((c.urls?.length ?? 0) > 0) g.frontendCount += 1;
    }
    map[key] = g;
  }
  // Pinned groups float to the top; alphabetical within each tier.
  return Object.values(map).sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
};

// A container card in the drill-in view, modeled 1:1 on the "Progress goals"
// reference: white chassis with a small header strip (icon chip + container
// name as title) above a tinted sage canvas containing a decorative circle +
// capsule vector, a top-right circular action button (external link → opens
// the primary URL), and a label / big-text / white-pill content block at the
// bottom (project name → primary domain or URL → status). Per-theme palette
// via useTheme.
const ContainerRow = ({ c, projectName }: { c: ContainerView; projectName: string }) => {
  const theme = useTheme();
  const isDark = theme === 'dark';

  const p = isDark
    ? {
        chassis: '#1a1f17',
        canvas: 'radial-gradient(circle at 20% 20%, #1f2a17 0%, #15201a 60%, #0e1a0c 100%)',
        title: '#e8f5d4',           // header container-name color
        iconChipBg: '#28342a',
        iconChipGlyph: '#9adc33',
        label: '#7a9658',
        bigText: '#c8e89e',
        circleVector: 'rgba(74, 107, 42, 0.30)',
        capsuleVector: '#5a8c2a',
        actionBg: '#9adc33',
        actionGlyph: '#0e1a0c',
        pillBg: '#28342a',
        pillText: '#c8e89e',
        chassisShadow: '0 10px 26px rgba(0,0,0,0.30)',
      }
    : {
        chassis: '#ffffff',
        canvas: 'radial-gradient(circle at 20% 20%, #f4f8ee 0%, #e8efe0 60%, #e1ebd5 100%)',
        title: '#35531b',
        iconChipBg: '#e2e6da',
        iconChipGlyph: '#485c2c',
        label: '#8da471',
        bigText: '#35531b',
        circleVector: 'rgba(186, 211, 153, 0.35)',
        capsuleVector: '#9adc33',
        actionBg: '#4f6327',
        actionGlyph: '#ffffff',
        pillBg: '#ffffff',
        pillText: '#35531b',
        chassisShadow: '0 14px 36px rgba(120, 130, 100, 0.08)',
      };

  const primary = c.urls && c.urls.length > 0 ? c.urls[0] : null;
  // Big text is the most actionable identifier we can show: a fronted domain
  // beats a raw IP:port beats the container name (services have no URL).
  const bigText = primary
    ? primary.viaNginx
      ? primary.domain ?? primary.url.replace(/^https?:\/\//, '')
      : primary.url.replace(/^https?:\/\//, '')
    : c.name;

  return (
    <div
      style={{
        background: p.chassis,
        borderRadius: '24px',
        padding: '14px 8px 8px 8px',
        boxShadow: p.chassisShadow,
      }}
    >
      {/* Header strip — icon chip + container name as the title. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', paddingLeft: '8px', paddingRight: '8px', minWidth: 0 }}>
        <div
          aria-hidden
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '28px',
            height: '28px',
            background: p.iconChipBg,
            borderRadius: '9px',
            flexShrink: 0,
          }}
        >
          <ContainerIcon style={{ width: '13px', height: '13px', color: p.iconChipGlyph }} strokeWidth={2.4} />
        </div>
        <div
          className="truncate"
          style={{
            color: p.title,
            fontWeight: 700,
            fontSize: '14px',
            letterSpacing: '-0.3px',
            lineHeight: 1.15,
            minWidth: 0,
            flex: 1,
          }}
          title={c.name}
        >
          {c.name}
        </div>
      </div>

      {/* Sage display canvas with decorative shapes. containerType lets the big
          text use cqw clamp to scale per-card. */}
      <div
        className="relative"
        style={{
          background: p.canvas,
          borderRadius: '20px',
          padding: '14px 16px 14px 16px',
          minHeight: '150px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          overflow: 'hidden',
          containerType: 'inline-size',
        }}
      >
        {/* Decorative circle */}
        <div
          aria-hidden
          className="absolute pointer-events-none"
          style={{
            bottom: '-40px',
            right: '-22px',
            width: '150px',
            height: '150px',
            borderRadius: '50%',
            background: p.circleVector,
            zIndex: 1,
          }}
        />
        {/* Decorative capsule */}
        <div
          aria-hidden
          className="absolute pointer-events-none"
          style={{
            bottom: '8px',
            right: '-16px',
            width: '40px',
            height: '108px',
            borderRadius: '40px',
            background: p.capsuleVector,
            transform: 'rotate(135deg)',
            zIndex: 2,
          }}
        />

        {/* Action button → opens the primary URL in a new tab. Skipped for
            services (no URLs). */}
        {primary && (
          <a
            href={primary.url}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`Open ${bigText}`}
            title={`Open ${primary.url}`}
            onClick={(e) => e.stopPropagation()}
            className="transition-transform"
            style={{
              position: 'absolute',
              top: '14px',
              right: '14px',
              width: '36px',
              height: '36px',
              background: p.actionBg,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: isDark ? '0 6px 16px rgba(0,0,0,0.35)' : '0 6px 16px rgba(79,99,39,0.20)',
              zIndex: 10,
              textDecoration: 'none',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.08)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
          >
            <ExternalLink style={{ width: '14px', height: '14px', color: p.actionGlyph }} strokeWidth={2.4} />
          </a>
        )}

        {/* Content: tiny project label → big focal text (domain/URL or container
            name fallback) → status pill on its own row. */}
        <div style={{ position: 'relative', zIndex: 5, display: 'flex', flexDirection: 'column', minWidth: 0, gap: '10px' }}>
          <div
            className="truncate"
            style={{
              fontSize: '11px',
              fontWeight: 700,
              color: p.label,
              letterSpacing: '0.4px',
              textTransform: 'uppercase',
              paddingRight: '44px', // clear the action button
            }}
            title={projectName}
          >
            {projectName}
          </div>

          {/* Focal: domain / IP:port / container name — fills full row, wraps
              gracefully on narrow cards. Linkified when a URL exists. */}
          {primary ? (
            <a
              href={primary.url}
              target="_blank"
              rel="noreferrer noopener"
              onClick={(e) => e.stopPropagation()}
              style={{
                color: p.bigText,
                fontWeight: 800,
                fontSize: 'clamp(22px, 9cqw, 38px)',
                letterSpacing: '-1.2px',
                lineHeight: 1.0,
                textDecoration: 'none',
                wordBreak: 'break-word',
                overflowWrap: 'anywhere',
                maxWidth: '100%',
              }}
              className="hover:underline underline-offset-4"
            >
              {bigText}
            </a>
          ) : (
            <span
              style={{
                color: p.bigText,
                fontWeight: 800,
                fontSize: 'clamp(22px, 9cqw, 38px)',
                letterSpacing: '-1.2px',
                lineHeight: 1.0,
                wordBreak: 'break-word',
                overflowWrap: 'anywhere',
                maxWidth: '100%',
              }}
              title={bigText}
            >
              {bigText}
            </span>
          )}

          {/* Status pill on its own row so it never crowds the focal text. */}
          <div>
            <span
              style={{
                display: 'inline-block',
                background: p.pillBg,
                padding: '5px 12px',
                borderRadius: '12px',
                fontSize: '12px',
                fontWeight: 700,
                color: p.pillText,
                boxShadow: isDark ? '0 3px 8px rgba(0,0,0,0.25)' : '0 3px 8px rgba(0,0,0,0.04)',
                letterSpacing: '-0.1px',
                whiteSpace: 'nowrap',
              }}
            >
              {c.status}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export const RunningApps = () => {
  const { servers, isLoading: serversLoading } = useServers();
  const serverStats = useServerStats(servers);
  const { list, setPinned, loading } = useRunningApps();
  const { isAdmin } = useAuth();
  const theme = useTheme();
  const isDark = theme === 'dark';

  const [selectedServer, setSelectedServer] = useState<string>('');
  const [projects, setProjects] = useState<ProjectGroup[]>([]);
  const [pinnedGroups, setPinnedGroups] = useState<string[]>([]);
  const [pinBusy, setPinBusy] = useState<string | null>(null); // groupName currently toggling
  const [agentMissing, setAgentMissing] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [servicesOpen, setServicesOpen] = useState(false); // services drill-in section is collapsed by default
  const [copied, setCopied] = useState(false);

  const selectedServerData = useMemo(() => servers.find((s) => s.id === selectedServer), [servers, selectedServer]);
  const serverStatus = (s: (typeof servers)[number]) =>
    s.status === 'online' ? 'online' : s.status === 'checking' ? 'idle' : 'offline';

  const pinnedSet = useMemo(() => new Set(pinnedGroups), [pinnedGroups]);
  const rootGroups = useMemo(() => buildRootGroups(projects, pinnedSet), [projects, pinnedSet]);
  const drillGroup = rootGroups.find((g) => g.name === selectedGroup);

  // For the drill view, split containers into Frontends (have URLs) and Services (don't).
  const drillSplit = useMemo(() => {
    const frontends: { c: ContainerView; project: string }[] = [];
    const services: { c: ContainerView; project: string }[] = [];
    if (drillGroup) {
      for (const p of drillGroup.projects) {
        for (const c of p.containers) {
          if ((c.urls?.length ?? 0) > 0) frontends.push({ c, project: p.project });
          else services.push({ c, project: p.project });
        }
      }
      frontends.sort((a, b) => a.c.name.localeCompare(b.c.name));
      services.sort((a, b) => a.c.name.localeCompare(b.c.name));
    }
    return { frontends, services };
  }, [drillGroup]);

  const load = async () => {
    if (!selectedServer) return;
    const data = await list(selectedServer);
    setProjects(data.projects || []);
    setPinnedGroups(data.pinned || []);
    setAgentMissing(!!data.agentMissing);
  };

  // Admin-only pin toggle. Optimistically updates local state so the card sorts
  // immediately; reverts and surfaces an error if the API call fails.
  const togglePin = async (groupName: string, nextPinned: boolean) => {
    if (!isAdmin || pinBusy) return;
    setPinBusy(groupName);
    const prev = pinnedGroups;
    setPinnedGroups(nextPinned ? [...prev, groupName] : prev.filter((g) => g !== groupName));
    const ok = await setPinned(selectedServer, groupName, nextPinned);
    if (!ok) setPinnedGroups(prev);
    setPinBusy(null);
  };

  useEffect(() => {
    setProjects([]);
    setPinnedGroups([]);
    setAgentMissing(false);
    setSelectedGroup(null);
    if (selectedServer) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServer]);

  const copyDeployCmd = async () => {
    try {
      await navigator.clipboard.writeText(AGENT_DEPLOY_CMD);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  };

  // ── Server picker (initial state) ───────────────────────────────────────
  if (!selectedServer) {
    // Don't flash the empty state while the initial fetch is in flight.
    if (!serversLoading && servers.length === 0) {
      return (
        <GlassCard>
          <div className="text-center py-16">
            <div className="h-24 w-24 rounded-2xl bg-[var(--card-warm)] border border-[var(--border)] flex items-center justify-center mx-auto mb-6">
              <Server className="h-12 w-12 text-[var(--ink-muted)]" />
            </div>
            <h3 className="mb-3 text-lg font-semibold text-[var(--ink)]">No Servers Configured</h3>
            <p className="text-[var(--ink-muted)] max-w-md mx-auto">
              Add a server from the Config &rsaquo; Infrastructure page to see its running apps.
            </p>
          </div>
        </GlassCard>
      );
    }
    return (
      <GlassCard>
        <div className="flex items-center gap-4 mb-6">
          <div className="h-12 w-12 rounded-2xl bg-[var(--accent-pink-soft)] flex items-center justify-center">
            <Rocket className="h-6 w-6 text-[var(--ink)]" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-[var(--ink)]">Running Apps</h2>
            <p className="text-[var(--ink-muted)] text-sm">Pick a server to see its compose projects and frontend URLs.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {servers.map((s) => (
            <ServerPickerCard
              key={s.id}
              name={s.name}
              address={s.address}
              status={s.status === 'online' ? 'online' : s.status === 'checking' ? 'checking' : 'offline'}
              stats={serverStats[s.id]}
              onClick={() => setSelectedServer(s.id)}
            />
          ))}
        </div>
      </GlassCard>
    );
  }

  // ── Server selected: header + (root-group grid OR drill-in) ─────────────
  return (
    <div className="space-y-6">
      <GlassCard className="p-0 overflow-hidden">
        <div className="p-6 flex items-center gap-4">
          {selectedGroup ? (
            <AccentButton variant="ghost" onClick={() => setSelectedGroup(null)}>
              <ChevronLeft className="h-4 w-4" />
              All groups
            </AccentButton>
          ) : (
            <div className="h-12 w-12 rounded-2xl bg-[var(--accent-pink-soft)] flex items-center justify-center">
              <Rocket className="h-6 w-6 text-[var(--ink)]" />
            </div>
          )}
          <div className="flex-1">
            <h2 className="text-xl font-semibold text-[var(--ink)]">
              {selectedGroup ? `/root/${selectedGroup}` : selectedServerData?.name || 'Server'}
            </h2>
            <p className="text-[var(--ink-muted)] text-sm">
              {selectedGroup
                ? `${drillSplit.frontends.length} frontend${drillSplit.frontends.length === 1 ? '' : 's'} · ${drillSplit.services.length} service${drillSplit.services.length === 1 ? '' : 's'}`
                : `${rootGroups.length} project group${rootGroups.length === 1 ? '' : 's'} on ${selectedServerData?.address}`}
            </p>
          </div>
          <AccentButton variant="ghost" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </AccentButton>
          <AccentButton
            variant="ghost"
            onClick={() => { setSelectedServer(''); setProjects([]); setSelectedGroup(null); }}
          >
            Change Server
          </AccentButton>
        </div>

        {/* Agent-missing banner */}
        {agentMissing && !selectedGroup && (
          <div className="px-6 pb-6">
            <div className="flex items-start gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card-warm)] p-4">
              <AlertTriangle className="h-5 w-5 text-[var(--accent-pink)] mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-[var(--ink)]">Helper agent not deployed on this server</div>
                <p className="text-xs text-[var(--ink-muted)] mt-1">
                  URLs fall back to <code>ip:port</code>. Deploy the agent once on this host so we can read its nginx confs and resolve domains.
                </p>
                <pre className="mt-3 max-w-full overflow-x-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-3 text-[11px] leading-relaxed text-[var(--ink)] whitespace-pre">
{AGENT_DEPLOY_CMD}
                </pre>
                <div className="mt-2">
                  <AccentButton variant="ghost" onClick={copyDeployCmd}>
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copied ? 'Copied' : 'Copy command'}
                  </AccentButton>
                </div>
              </div>
            </div>
          </div>
        )}
      </GlassCard>

      {/* Grid of root-group folder cards (with stats sidebar on the left) */}
      {!selectedGroup && (() => {
        // Totals shown in the left stats panel.
        const totalApps = rootGroups.length;
        const totalCompose = rootGroups.reduce((s, g) => s + g.projects.length, 0);
        const totalContainers = rootGroups.reduce((s, g) => s + g.containerCount, 0);
        return (
        <div className="flex flex-col lg:flex-row gap-8">
          {/* ── Stats sidebar — dark premium in dark mode, colorful tinted in light mode ── */}
          <aside className="w-full lg:w-60 shrink-0 grid grid-cols-3 lg:grid-cols-1 gap-5">
            {(isDark
              ? [
                  { label: 'Applications',  value: totalApps,         Icon: undefined,     accent: '#ffffff', tint: '',                          bg: '#222222',                                              border: '#111111' },
                  { label: 'Containers',    value: totalContainers,   Icon: undefined,     accent: '#ffffff', tint: '',                          bg: '#222222',                                              border: '#111111' },
                  { label: 'Compose Files', value: totalCompose,      Icon: undefined,     accent: '#ffffff', tint: '',                          bg: '#222222',                                              border: '#111111' },
                ]
              : [
                  { label: 'Applications',  value: totalApps,         Icon: Layers,        accent: '#007acc', tint: 'rgba(0,122,204,0.10)',      bg: 'linear-gradient(160deg, #f0f9ff 0%, #d9eeff 100%)',    border: '#9fd3ff' },
                  { label: 'Containers',    value: totalContainers,   Icon: ContainerIcon, accent: '#0a7d3e', tint: 'rgba(10,125,62,0.10)',      bg: 'linear-gradient(160deg, #ecfbf2 0%, #cdf3dd 100%)',    border: '#9fdfba' },
                  { label: 'Compose Files', value: totalCompose,      Icon: FileCode2,     accent: '#7b3fbf', tint: 'rgba(123,63,191,0.10)',     bg: 'linear-gradient(160deg, #f7f1ff 0%, #e2d2f8 100%)',    border: '#c3a7e8' },
                ]
            ).map((stat) => (
              <div
                key={stat.label}
                className="relative overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
                style={{
                  background: stat.bg,
                  border: `${isDark ? '4px' : '2px'} solid ${stat.border}`,
                  borderRadius: isDark ? '28px' : '22px',
                  padding: isDark ? '28px 24px' : '22px',
                  boxShadow: isDark ? '0 10px 25px rgba(0,0,0,0.08)' : '0 4px 14px rgba(15, 23, 42, 0.04)',
                }}
              >
                {/* Light theme: soft accent blob + icon chip. Dark theme: pure number+label. */}
                {!isDark && stat.tint && (
                  <div
                    aria-hidden
                    className="absolute"
                    style={{
                      top: '-18px', right: '-18px',
                      width: '90px', height: '90px',
                      borderRadius: '999px',
                      background: stat.tint,
                      filter: 'blur(2px)',
                    }}
                  />
                )}
                {!isDark && stat.Icon && (
                  <div
                    className="relative flex items-center justify-center"
                    style={{
                      width: '40px', height: '40px',
                      borderRadius: '12px',
                      background: 'rgba(255,255,255,0.75)',
                      border: `1px solid ${stat.border}`,
                      boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
                    }}
                  >
                    <stat.Icon style={{ width: '20px', height: '20px', color: stat.accent }} strokeWidth={2} />
                  </div>
                )}
                <div
                  className="relative tabular-nums"
                  style={{
                    fontSize: isDark ? '42px' : '40px',
                    fontWeight: 800,
                    color: stat.accent,
                    lineHeight: 1,
                    marginTop: isDark ? 0 : '14px',
                    letterSpacing: '-0.02em',
                  }}
                >
                  {stat.value}
                </div>
                <div
                  className="relative"
                  style={
                    isDark
                      ? { fontSize: '14px', fontWeight: 600, color: '#9aa0a6', marginTop: '10px' }
                      : { fontSize: '12px', fontWeight: 700, color: '#1f2937', textTransform: 'uppercase', letterSpacing: '0.9px', marginTop: '8px', opacity: 0.75 }
                  }
                >
                  {stat.label}
                </div>
              </div>
            ))}
          </aside>

          {/* ── Cards grid (fluid; fills the remaining width) ── */}
          <div className="flex-1 min-w-0">
          {loading && rootGroups.length === 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              <GlassSkeleton.Card count={6} />
            </div>
          ) : rootGroups.length === 0 ? (
            <GlassCard>
              <div className="text-center py-16">
                <FolderKanban className="h-12 w-12 text-[var(--ink-muted)] mx-auto mb-3" />
                <p className="text-[var(--ink-muted)]">No compose projects running on this server.</p>
              </div>
            </GlassCard>
          ) : (
            <>
              {/* Single shared clip-path definition used by every card's folder body */}
              <svg className="absolute w-0 h-0" aria-hidden>
                <defs>
                  <clipPath id="folder-clip-square-optimized" clipPathUnits="objectBoundingBox">
                    <path d="M 0,0 L 0.42,0 A 0.04,0.05 0 0,1 0.45,0.02 L 0.52,0.12 A 0.04,0.05 0 0,0 0.55,0.14 L 1,0.14 L 1,1 L 0,1 Z" />
                  </clipPath>
                </defs>
              </svg>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {rootGroups.map((g) => {
                  // Per-theme palette. Dark = premium-glossy (red/blue gradient
                  // + dark body + glossy sheen). Light = the previous flat
                  // orange/blue with cream body.
                  const theme = isDark
                    ? g.pinned
                      ? {
                          outer: 'linear-gradient(180deg, #ef4444 0%, #b91c1c 100%)',
                          border: '#111111',
                          body: '#222222',
                          title: '#ffffff',
                          subtitle: '#9aa0a6',
                          number: '#ffffff',
                          label: '#9aa0a6',
                          radius: '36px',
                          padding: '9.2cqw',
                          bodyHeight: '66%',
                          titleSize: 'clamp(14px, 8.75cqw, 24px)',
                          titleWeight: 600 as const,
                          numberSize: 'clamp(22px, 14.17cqw, 38px)',
                          labelSize: 'clamp(10px, 5.42cqw, 15px)',
                          gloss: true,
                          baseShadow: '0 12px 30px rgba(0,0,0,0.12)',
                          hoverShadow: '0 20px 40px rgba(0,0,0,0.18)',
                          pinIcon: '#b91c1c',
                          pinChipBgUnpinned: 'rgba(255,255,255,0.2)',
                          pinChipBorderUnpinned: 'rgba(255,255,255,0.45)',
                        }
                      : {
                          outer: 'linear-gradient(180deg, #3b82f6 0%, #1d4ed8 100%)',
                          border: '#111111',
                          body: '#222222',
                          title: '#ffffff',
                          subtitle: '#9aa0a6',
                          number: '#ffffff',
                          label: '#9aa0a6',
                          radius: '36px',
                          padding: '9.2cqw',
                          bodyHeight: '66%',
                          titleSize: 'clamp(14px, 8.75cqw, 24px)',
                          titleWeight: 600 as const,
                          numberSize: 'clamp(22px, 14.17cqw, 38px)',
                          labelSize: 'clamp(10px, 5.42cqw, 15px)',
                          gloss: true,
                          baseShadow: '0 12px 30px rgba(0,0,0,0.12)',
                          hoverShadow: '0 20px 40px rgba(0,0,0,0.18)',
                          pinIcon: '#1d4ed8',
                          pinChipBgUnpinned: 'rgba(255,255,255,0.2)',
                          pinChipBorderUnpinned: 'rgba(255,255,255,0.45)',
                        }
                    : g.pinned
                      ? {
                          outer: '#e85d2f',
                          border: '#ffc9b3',
                          body: '#fdf0e8',
                          title: '#3a1a0c',
                          subtitle: '#8a5a4a',
                          number: '#2a0e04',
                          label: '#8a5a4a',
                          radius: '32px',
                          padding: '8.3cqw',
                          bodyHeight: '70%',
                          titleSize: 'clamp(14px, 9.17cqw, 26px)',
                          titleWeight: 700 as const,
                          numberSize: 'clamp(22px, 15.83cqw, 42px)',
                          labelSize: 'clamp(11px, 5.83cqw, 16px)',
                          gloss: false,
                          baseShadow: '0 4px 12px rgba(232,93,47,0.06)',
                          hoverShadow: '0 12px 24px rgba(232,93,47,0.18)',
                          pinIcon: '#e85d2f',
                          pinChipBgUnpinned: 'rgba(255,255,255,0.18)',
                          pinChipBorderUnpinned: 'rgba(255,255,255,0.35)',
                        }
                      : {
                          outer: '#1aa3ff',
                          border: '#b3e0ff',
                          body: '#f0f7fc',
                          title: '#092c47',
                          subtitle: '#52728c',
                          number: '#051624',
                          label: '#52728c',
                          radius: '32px',
                          padding: '8.3cqw',
                          bodyHeight: '70%',
                          titleSize: 'clamp(14px, 9.17cqw, 26px)',
                          titleWeight: 700 as const,
                          numberSize: 'clamp(22px, 15.83cqw, 42px)',
                          labelSize: 'clamp(11px, 5.83cqw, 16px)',
                          gloss: false,
                          baseShadow: '0 4px 12px rgba(0, 153, 255, 0.02)',
                          hoverShadow: '0 12px 24px rgba(0,153,255,0.10)',
                          pinIcon: '#1aa3ff',
                          pinChipBgUnpinned: 'rgba(255,255,255,0.18)',
                          pinChipBorderUnpinned: 'rgba(255,255,255,0.35)',
                        };
                  return (
                  <button
                    key={g.name}
                    onClick={() => setSelectedGroup(g.name)}
                    className={`relative aspect-square overflow-hidden text-left flex flex-col justify-end focus:outline-none focus-visible:outline-none transition-all duration-[250ms] ease-out ${isDark ? 'hover:-translate-y-1.5' : 'hover:-translate-y-1'}`}
                    style={{
                      background: theme.outer,
                      borderRadius: theme.radius,
                      border: `4px solid ${theme.border}`,
                      boxSizing: 'border-box',
                      boxShadow: theme.baseShadow,
                      containerType: 'inline-size',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.boxShadow = theme.hoverShadow; }}
                    onMouseLeave={(e) => { e.currentTarget.style.boxShadow = theme.baseShadow; }}
                  >
                    {/* Glossy highlight (dark theme only) — subtle wet sheen on
                        the top 40% of the gradient. */}
                    {theme.gloss && (
                      <div
                        aria-hidden
                        className="absolute pointer-events-none"
                        style={{
                          top: 0, left: 0, right: 0,
                          height: '40%',
                          background: 'linear-gradient(180deg, rgba(255,255,255,0.15) 0%, transparent 100%)',
                          zIndex: 1,
                        }}
                      />
                    )}
                    {/* Pin control — sits over the blue tab area (top-right).
                        Admin: clickable toggle. Non-admin: static indicator that
                        only renders when pinned. Uses role="button" so we don't
                        nest a real <button> inside the card <button>. */}
                    {(isAdmin || g.pinned) && (
                      <div
                        role={isAdmin ? 'button' : undefined}
                        aria-label={isAdmin ? (g.pinned ? `Unpin ${g.name}` : `Pin ${g.name}`) : g.pinned ? `${g.name} is pinned` : undefined}
                        aria-pressed={isAdmin ? g.pinned : undefined}
                        tabIndex={isAdmin ? 0 : -1}
                        onClick={(e) => {
                          if (!isAdmin) return;
                          e.stopPropagation();
                          togglePin(g.name, !g.pinned);
                        }}
                        onKeyDown={(e) => {
                          if (!isAdmin) return;
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            togglePin(g.name, !g.pinned);
                          }
                        }}
                        className={`absolute z-10 flex items-center justify-center transition-all ${isAdmin ? 'cursor-pointer hover:scale-110' : ''} ${pinBusy === g.name ? 'opacity-60' : ''}`}
                        style={{
                          top: '4.5cqw',
                          right: '4.5cqw',
                          width: '11cqw',
                          height: '11cqw',
                          minWidth: '28px',
                          minHeight: '28px',
                          borderRadius: '999px',
                          background: g.pinned ? '#ffffff' : theme.pinChipBgUnpinned,
                          border: `2px solid ${g.pinned ? '#ffffff' : theme.pinChipBorderUnpinned}`,
                          boxShadow: g.pinned ? '0 2px 6px rgba(0,0,0,0.20)' : 'none',
                          backdropFilter: !g.pinned && isDark ? 'blur(4px)' : 'none',
                        }}
                        title={isAdmin ? (g.pinned ? 'Unpin' : 'Pin to top') : 'Pinned'}
                      >
                        <Pin
                          style={{
                            width: '55%',
                            height: '55%',
                            color: g.pinned ? theme.pinIcon : '#ffffff',
                            fill: g.pinned ? theme.pinIcon : 'transparent',
                          }}
                          strokeWidth={2.2}
                        />
                      </div>
                    )}

                    {/* Inner folder body — palette swaps per theme. */}
                    <div
                      className="flex flex-col justify-between relative"
                      style={{
                        width: '100%',
                        height: theme.bodyHeight,
                        background: theme.body,
                        padding: theme.padding,
                        boxSizing: 'border-box',
                        clipPath: 'url(#folder-clip-square-optimized)',
                        zIndex: 2,
                      }}
                    >
                      <div className="flex flex-col min-w-0">
                        <div
                          className="truncate"
                          style={{
                            color: theme.title,
                            fontWeight: theme.titleWeight,
                            letterSpacing: '-0.018em',
                            fontSize: theme.titleSize,
                            lineHeight: 1.1,
                            fontFamily: 'inherit',
                            wordBreak: 'break-all',
                            paddingRight: isDark ? '8.3cqw' : 0,
                          }}
                        >
                          {g.name}
                        </div>
                        <div
                          className="truncate"
                          style={{
                            color: theme.subtitle,
                            fontWeight: 500,
                            fontSize: isDark ? 'clamp(11px, 5.83cqw, 16px)' : 'clamp(11px, 6.25cqw, 18px)',
                            lineHeight: 1.2,
                            marginTop: isDark ? '2.5cqw' : '1.67cqw',
                            fontFamily: 'inherit',
                          }}
                        >
                          {g.projects.length} compose file{g.projects.length === 1 ? '' : 's'}
                        </div>
                      </div>

                      <div className="flex items-baseline" style={{ gap: '2.5cqw' }}>
                        <span
                          className="tabular-nums"
                          style={{
                            fontSize: theme.numberSize,
                            fontWeight: 800,
                            color: theme.number,
                            lineHeight: 1,
                          }}
                        >
                          {String(g.containerCount).padStart(2, '0')}
                        </span>
                        <span
                          style={{
                            fontSize: theme.labelSize,
                            fontWeight: 600,
                            color: theme.label,
                            lineHeight: 1,
                          }}
                        >
                          Containers
                        </span>
                      </div>
                    </div>
                  </button>
                  );
                })}
              </div>
            </>
          )}
          </div>
        </div>
        );
      })()}

      {/* Drill-in: frontends first, services below */}
      {selectedGroup && drillGroup && (
        <>
          <GlassCard className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-[var(--ink)]">Frontends</h3>
              <span className="text-xs text-[var(--ink-muted)]">
                {drillSplit.frontends.length} with published ports
              </span>
            </div>
            {drillSplit.frontends.length === 0 ? (
              <p className="text-sm text-[var(--ink-muted)]">No containers with published ports.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {drillSplit.frontends.map(({ c, project }) => (
                  <ContainerRow key={c.id} c={c} projectName={project} />
                ))}
              </div>
            )}
          </GlassCard>

          <GlassCard className="p-6">
            <button
              type="button"
              onClick={() => setServicesOpen((o) => !o)}
              className={`w-full flex items-center justify-between text-left focus:outline-none rounded-lg ${servicesOpen ? 'mb-4' : ''}`}
              aria-expanded={servicesOpen}
              aria-controls="services-list"
            >
              <div className="flex items-center gap-2">
                <ChevronDown
                  className={`h-4 w-4 text-[var(--ink-muted)] transition-transform duration-200 ${servicesOpen ? '' : '-rotate-90'}`}
                />
                <h3 className="text-base font-semibold text-[var(--ink)]">Services</h3>
              </div>
              <span className="text-xs text-[var(--ink-muted)]">
                {drillSplit.services.length} without published ports
              </span>
            </button>
            {servicesOpen && (
              drillSplit.services.length === 0 ? (
                <p className="text-sm text-[var(--ink-muted)]">No background services.</p>
              ) : (
                <div id="services-list" className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                  {drillSplit.services.map(({ c, project }) => (
                    <ContainerRow key={c.id} c={c} projectName={project} />
                  ))}
                </div>
              )
            )}
          </GlassCard>
        </>
      )}
    </div>
  );
};
