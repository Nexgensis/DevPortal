import { useEffect, useMemo, useState } from 'react';
import { useServers } from '../hooks/useServers';
import { useServerStats } from '../hooks/useServerStats';
import { useRunningApps } from '../hooks/useRunningApps';
import { useAuth } from '../hooks/useAuth';
import { ProjectGroup, ContainerView } from '../types/runningapps';
import { Rocket, Server, ChevronRight, ChevronLeft, ChevronDown, ExternalLink, FolderKanban, AlertTriangle, Copy, Check, RefreshCw, Pin, Globe, Layers, Container as ContainerIcon, FileCode2, Search } from 'lucide-react';
import { GlassCard } from './ui/glass-card';
import { AccentButton } from './ui/accent-button';
import { StatusBadge } from './ui/status-badge';
import { GlassSkeleton } from './ui/glass-skeleton';
import { PillTag } from './ui/pill-tag';
import { ServerPickerCard } from './ui/server-picker-card';
import { useTheme } from '../hooks/useTheme';

// One-line copy-paste deploy command for the helper agent. Shown inline when a
// server reports agentMissing so admins can paste-and-run on the host.
const AGENT_DEPLOY_CMD = `docker run -d --name nexus-aura-agent --restart unless-stopped \\
  --label nexus-aura.agent=true \\
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
        canvas: 'radial-gradient(circle at 20% 20%, #f3f1ff 0%, #ebe7ff 60%, #e2dcff 100%)',
        title: '#2e2566',
        iconChipBg: '#e6e2fa',
        iconChipGlyph: '#5b4dff',
        label: '#8b86b8',
        bigText: '#2e2566',
        circleVector: 'rgba(150, 130, 255, 0.28)',
        capsuleVector: '#8b7cff',
        actionBg: '#4f43c9',
        actionGlyph: '#ffffff',
        pillBg: '#ffffff',
        pillText: '#2e2566',
        chassisShadow: '0 14px 36px rgba(91, 77, 255, 0.08)',
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
      {/* Header strip — icon chip + project name as the title. */}
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
            fontSize: '16px',
            letterSpacing: '-0.3px',
            lineHeight: 1.15,
            minWidth: 0,
            flex: 1,
          }}
          title={projectName}
        >
          {projectName}
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
            bottom: '-30px',
            right: '-18px',
            width: '100px',
            height: '100px',
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
            bottom: '10px',
            right: '-10px',
            width: '26px',
            height: '72px',
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

        {/* Content: tiny container label → focal text (domain/URL or container
            name fallback) → status pill on its own row. */}
        <div style={{ position: 'relative', zIndex: 5, display: 'flex', flexDirection: 'column', minWidth: 0, gap: '8px' }}>
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
            title={c.name}
          >
            {c.name}
          </div>

          {/* Focal: domain / IP:port / container name — THE HERO of the card.
              Scales aggressively with card width; wraps for very long domains
              rather than ellipsizing so the full URL stays readable. */}
          {primary ? (
            <a
              href={primary.url}
              target="_blank"
              rel="noreferrer noopener"
              onClick={(e) => e.stopPropagation()}
              className="hover:underline underline-offset-4 block"
              style={{
                color: p.bigText,
                fontWeight: 800,
                fontSize: 'clamp(18px, 8.2cqw, 30px)',
                letterSpacing: '-0.9px',
                lineHeight: 1.05,
                textDecoration: 'none',
                wordBreak: 'break-word',
                overflowWrap: 'anywhere',
                maxWidth: '100%',
              }}
              title={bigText}
            >
              {bigText}
            </a>
          ) : (
            <span
              className="block"
              style={{
                color: p.bigText,
                fontWeight: 800,
                fontSize: 'clamp(18px, 8.2cqw, 30px)',
                letterSpacing: '-0.9px',
                lineHeight: 1.05,
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
  const [drillSearch, setDrillSearch] = useState('');

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

  // Case-insensitive container-name filter applied to both lists.
  const drillSplitFiltered = useMemo(() => {
    const q = drillSearch.trim().toLowerCase();
    if (!q) return drillSplit;
    return {
      frontends: drillSplit.frontends.filter(({ c }) => c.name.toLowerCase().includes(q)),
      services: drillSplit.services.filter(({ c }) => c.name.toLowerCase().includes(q)),
    };
  }, [drillSplit, drillSearch]);

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
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-semibold text-[var(--ink)] truncate" title={selectedGroup ? `${selectedServerData?.name ?? ''}/root/${selectedGroup}` : selectedServerData?.name}>
              {selectedGroup
                ? `${selectedServerData?.name ?? ''}/root/${selectedGroup}`
                : selectedServerData?.name || 'Server'}
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
        // Totals + breakdowns shown in the left stats panel.
        const totalApps = rootGroups.length;
        const totalCompose = rootGroups.reduce((s, g) => s + g.projects.length, 0);
        const totalContainers = rootGroups.reduce((s, g) => s + g.containerCount, 0);
        const totalFrontends = rootGroups.reduce((s, g) => s + g.frontendCount, 0); // containers with a published port
        const totalServices = totalContainers - totalFrontends;
        const pinnedCount = rootGroups.filter((g) => g.pinned).length;
        const exposedApps = rootGroups.filter((g) => g.frontendCount > 0).length; // groups with ≥1 frontend
        const avgPerApp = totalApps ? (totalContainers / totalApps).toFixed(1) : '0';
        return (
        <div className="flex flex-col lg:flex-row gap-8">
          {/* ── Stats sidebar — dark premium in dark mode, colorful tinted in light mode ── */}
          <aside className="w-full lg:w-60 shrink-0 grid grid-cols-3 lg:grid-cols-1 gap-5">
            {(isDark
              ? [
                  { label: 'Applications',  value: totalApps,         Icon: undefined,     accent: '#ffffff', tint: '',                          bg: '#222222',                                              border: '#111111', sub: `${pinnedCount} pinned · ${exposedApps} exposed`,        barFrac: totalApps ? exposedApps / totalApps : 0 },
                  { label: 'Containers',    value: totalContainers,   Icon: undefined,     accent: '#ffffff', tint: '',                          bg: '#222222',                                              border: '#111111', sub: `${totalFrontends} frontends · ${totalServices} services`, barFrac: totalContainers ? totalFrontends / totalContainers : 0 },
                  { label: 'Compose Files', value: totalCompose,      Icon: undefined,     accent: '#ffffff', tint: '',                          bg: '#222222',                                              border: '#111111', sub: `${avgPerApp} containers / app avg`,                      barFrac: null as number | null },
                ]
              : [
                  { label: 'Applications',  value: totalApps,         Icon: Layers,        accent: '#4f43c9', tint: 'rgba(91,77,255,0.10)',      bg: 'linear-gradient(160deg, #f4f2ff 0%, #e1dcff 100%)',    border: '#c6bff5', sub: `${pinnedCount} pinned · ${exposedApps} exposed`,        barFrac: totalApps ? exposedApps / totalApps : 0 },
                  { label: 'Containers',    value: totalContainers,   Icon: ContainerIcon, accent: '#0a7d3e', tint: 'rgba(10,125,62,0.10)',      bg: 'linear-gradient(160deg, #ecfbf2 0%, #cdf3dd 100%)',    border: '#9fdfba', sub: `${totalFrontends} frontends · ${totalServices} services`, barFrac: totalContainers ? totalFrontends / totalContainers : 0 },
                  { label: 'Compose Files', value: totalCompose,      Icon: FileCode2,     accent: '#7b3fbf', tint: 'rgba(123,63,191,0.10)',     bg: 'linear-gradient(160deg, #f7f1ff 0%, #e2d2f8 100%)',    border: '#c3a7e8', sub: `${avgPerApp} containers / app avg`,                      barFrac: null as number | null },
                ]
            ).map((stat) => (
              <div
                key={stat.label}
                className="lift-shadow relative overflow-hidden hover:-translate-y-0.5 hover:shadow-md"
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

                {/* Breakdown detail line */}
                <div
                  className="relative"
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    color: isDark ? '#7e848a' : 'rgba(31,41,55,0.62)',
                    marginTop: '7px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={stat.sub}
                >
                  {stat.sub}
                </div>

                {/* Proportion bar (e.g. frontends share of containers) */}
                {stat.barFrac != null && (
                  <div
                    className="relative mt-2.5 h-1.5 rounded-full overflow-hidden"
                    style={{ background: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.07)' }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.max(4, Math.round(stat.barFrac * 100))}%`, background: stat.accent }}
                    />
                  </div>
                )}
              </div>
            ))}
          </aside>

          {/* ── Cards grid (fluid; fills the remaining width) ── */}
          <div className="flex-1 min-w-0">
          {loading && rootGroups.length === 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5">
              {rootGroups.map((g) => {
                // Same white-chassis + gradient-canvas card as the Database Dump
                // page, so Running Apps reads as one product. Indigo for normal
                // projects, on-palette coral for pinned.
                const accent = g.pinned
                  ? 'linear-gradient(160deg, #ff7a6e 0%, #ff5a5f 100%)'
                  : 'linear-gradient(160deg, #5b4dff 0%, #4133ff 55%, #2e22d4 100%)';
                return (
                  <button
                    key={g.name}
                    onClick={() => setSelectedGroup(g.name)}
                    className="lift rounded-[22px] border bg-[var(--card)] p-2 flex flex-col text-left hover:-translate-y-1 focus:outline-none focus-ring-cyan"
                    style={{
                      borderColor: g.pinned ? 'color-mix(in srgb, #ff5a5f 38%, var(--border))' : 'var(--border)',
                      ['--lift-glow' as any]: g.pinned ? '0 14px 32px rgba(255,90,95,0.16)' : '0 14px 32px rgba(65,51,255,0.13)',
                    }}
                  >
                    {/* Gradient canvas */}
                    <div className="relative rounded-[16px] px-4 py-4 overflow-hidden" style={{ background: accent }}>
                      {/* Glossy top sheen — matches the DB cards. */}
                      <div
                        aria-hidden
                        className="absolute inset-x-0 top-0 h-[40%] pointer-events-none"
                        style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.14) 0%, transparent 100%)' }}
                      />

                      {/* Top row: project glyph + pin toggle */}
                      <div className="relative flex items-center justify-between mb-4">
                        <span className="grid h-8 w-8 place-items-center rounded-xl bg-white/20 text-white">
                          <Layers className="h-4 w-4" />
                        </span>
                        {(isAdmin || g.pinned) && (
                          <span
                            role={isAdmin ? 'button' : undefined}
                            aria-label={isAdmin ? (g.pinned ? `Unpin ${g.name}` : `Pin ${g.name}`) : g.pinned ? `${g.name} is pinned` : undefined}
                            aria-pressed={isAdmin ? g.pinned : undefined}
                            tabIndex={isAdmin ? 0 : -1}
                            onClick={(e) => { if (!isAdmin) return; e.stopPropagation(); togglePin(g.name, !g.pinned); }}
                            onKeyDown={(e) => { if (!isAdmin) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); togglePin(g.name, !g.pinned); } }}
                            className={`grid h-7 w-7 place-items-center rounded-full shrink-0 transition-transform ${isAdmin ? 'cursor-pointer hover:scale-110' : ''} ${pinBusy === g.name ? 'opacity-60' : ''}`}
                            style={{ background: g.pinned ? '#ffffff' : 'rgba(255,255,255,0.20)' }}
                            title={isAdmin ? (g.pinned ? 'Unpin' : 'Pin to top') : 'Pinned'}
                          >
                            <Pin
                              className="h-3.5 w-3.5"
                              style={{ color: g.pinned ? '#ff5a5f' : '#ffffff', fill: g.pinned ? '#ff5a5f' : 'transparent' }}
                              strokeWidth={2.2}
                            />
                          </span>
                        )}
                      </div>

                      {/* Project name + compose count */}
                      <h3 className="relative text-[20px] font-bold leading-[1.15] tracking-tight text-white truncate" title={g.name}>
                        {g.name}
                      </h3>
                      <p className="relative text-[12px] font-medium text-white/65 mt-1">
                        {g.projects.length} compose file{g.projects.length === 1 ? '' : 's'}
                      </p>
                    </div>

                    {/* Footer: container count */}
                    <div className="px-2.5 pt-3 pb-1.5 flex items-baseline gap-2">
                      <span className="text-[22px] font-bold tabular-nums text-[var(--ink)] leading-none">
                        {String(g.containerCount).padStart(2, '0')}
                      </span>
                      <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--ink-muted)]">
                        Containers
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          </div>
        </div>
        );
      })()}

      {/* Drill-in: search bar, then frontends, then services */}
      {selectedGroup && drillGroup && (
        <>
          {/* Container-name search across both Frontends and Services. */}
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ink-muted)] pointer-events-none" />
            <input
              type="text"
              value={drillSearch}
              onChange={(e) => setDrillSearch(e.target.value)}
              placeholder="Search containers…"
              className="w-full h-10 pl-9 pr-3 rounded-xl bg-[var(--card)] border border-[var(--border)] text-sm text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:outline-none focus:border-[var(--ink)]/30 transition-colors"
            />
          </div>

          <GlassCard className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-[var(--ink)]">Frontends</h3>
              <span className="text-xs text-[var(--ink-muted)]">
                {drillSearch
                  ? `${drillSplitFiltered.frontends.length} of ${drillSplit.frontends.length} matching`
                  : `${drillSplit.frontends.length} with published ports`}
              </span>
            </div>
            {drillSplit.frontends.length === 0 ? (
              <p className="text-sm text-[var(--ink-muted)]">No containers with published ports.</p>
            ) : drillSplitFiltered.frontends.length === 0 ? (
              <p className="text-sm text-[var(--ink-muted)]">No frontends match "{drillSearch}".</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {drillSplitFiltered.frontends.map(({ c, project }) => (
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
                {drillSearch
                  ? `${drillSplitFiltered.services.length} of ${drillSplit.services.length} matching`
                  : `${drillSplit.services.length} without published ports`}
              </span>
            </button>
            {servicesOpen && (
              drillSplit.services.length === 0 ? (
                <p className="text-sm text-[var(--ink-muted)]">No background services.</p>
              ) : drillSplitFiltered.services.length === 0 ? (
                <p className="text-sm text-[var(--ink-muted)]">No services match "{drillSearch}".</p>
              ) : (
                <div id="services-list" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                  {drillSplitFiltered.services.map(({ c, project }) => (
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
