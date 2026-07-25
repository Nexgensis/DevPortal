import { useState, useEffect } from 'react';
import { usePostgres } from '../hooks/usePostgres';
import { useServers } from '../hooks/useServers';
import { useRoute } from '../hooks/useRoute';
import { useServerStats } from '../hooks/useServerStats';
import { useAuth } from '../hooks/useAuth';
import { PostgresContainer, PostgresDatabase, PostgresCredential, PostgresContainerContext } from '../types/postgres';
import { Database, Download, Server, Container, ChevronRight, KeyRound, Eye, EyeOff, Search, Upload, FileUp, AlertCircle, FolderOpen, Sparkles } from 'lucide-react';
import { ScrollArea } from './ui/scroll-area';
import { GlassCard } from './ui/glass-card';
import { AccentButton } from './ui/accent-button';
import { GlassSkeleton } from './ui/glass-skeleton';
import { StatusBadge } from './ui/status-badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { ServerPickerCard } from './ui/server-picker-card';
import { DumpStatsStrip } from './DumpStatsStrip';
import { useDumpStats } from '../hooks/useDumpStats';

// parseContainerStatus splits Docker's "Up X minutes (healthy)" into a concise
// duration label + a health flag the sidebar can render as a colored dot.
const parseContainerStatus = (s: string): { duration: string; health: 'healthy' | 'unhealthy' | 'starting' | 'none' } => {
  if (!s) return { duration: '—', health: 'none' };
  const healthMatch = s.match(/\((\w+)\)/);
  const rawHealth = healthMatch ? healthMatch[1].toLowerCase() : '';
  let health: 'healthy' | 'unhealthy' | 'starting' | 'none' = 'none';
  if (rawHealth === 'healthy') health = 'healthy';
  else if (rawHealth === 'unhealthy') health = 'unhealthy';
  else if (rawHealth === 'starting' || rawHealth === 'health: starting') health = 'starting';
  // Compact the duration: "Up About a minute" → "≈1 min", "Up 24 minutes" → "24 min"
  let duration = s.replace(/^Up\s+/, '').replace(/\s*\(\w+\)$/, '').trim();
  duration = duration
    .replace(/^About an?\s+/i, '≈1 ')
    .replace(/\bminutes?\b/i, 'min')
    .replace(/\bhours?\b/i, 'hr')
    .replace(/\bseconds?\b/i, 's')
    .replace(/\bdays?\b/i, 'd');
  return { duration, health };
};

const HEALTH_DOT_COLOR: Record<'healthy' | 'unhealthy' | 'starting' | 'none', string> = {
  healthy: 'var(--accent-green)',
  unhealthy: 'var(--accent-destructive)',
  starting: 'var(--accent-peach)',
  none: 'var(--ink-muted)',
};

// formatBytes converts a raw byte count into a short human label. Used by the
// streaming download progress UI.
const formatBytes = (n: number): string => {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
};

// parseSizeToBytes turns the human-readable db.size string ("717 MB", "1.2 GB")
// back into bytes. Used as the expected total for the download progress bar
// since pg_dump streams chunked (no Content-Length on the response). The dump's
// SQL output is roughly the same order of magnitude as the live DB size, so
// using db.size gives a meaningful percentage even though it's an estimate.
const parseSizeToBytes = (size: string | undefined | null): number | null => {
  if (!size) return null;
  const m = size.trim().match(/^([\d.]+)\s*(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB)$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2].toUpperCase().replace('I', '');
  const mult: Record<string, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
  const factor = mult[unit];
  if (!factor) return null;
  return Math.round(n * factor);
};

// containerColor derives a stable accent color from a container name so each
// sidebar row carries its own colored identity (the glyph stays the shared
// database icon — only the color varies). Same name → same color on every
// render/reload (pure char-sum hash, no Math.random). Colors reuse existing
// theme hues so both light and dark stay on-palette.
const IDENTITY_COLORS = ['#4285F4', '#5B4DFF', '#FF5A5F', '#10B981', '#A04EF6', '#FF6B35', '#0F9D9D', '#FBBC05'];
const containerColor = (name: string): string => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return IDENTITY_COLORS[h % IDENTITY_COLORS.length];
};

interface DumpProgress {
  received: number;
  total: number | null; // null = indeterminate (chunked transfer w/o Content-Length)
}

export const PostgresManager = () => {
  const { servers, isLoading: serversLoading } = useServers();
  const serverStats = useServerStats(servers);
  const { getContainers, getDatabases, createDump, restoreDump, getCredentials, saveCredential, deleteCredential, getContainerContext, loading } = usePostgres();
  const { isAdmin } = useAuth();
  const { data: dumpStats, loading: dumpStatsLoading, reload: reloadDumpStats } = useDumpStats();

  // Server selection lives in the URL (?server=<id>) so the view is linkable
  // and Back returns to the picker instead of leaving the app.
  const { route, navigate } = useRoute();
  const selectedServer = route.server ?? '';
  const setSelectedServer = (id: string) => navigate({ server: id || null });

  const [containers, setContainers] = useState<PostgresContainer[]>([]);
  const [selectedContainer, setSelectedContainer] = useState<string>('');
  const [databases, setDatabases] = useState<PostgresDatabase[]>([]);
  const [loadingContainers, setLoadingContainers] = useState(false);
  const [loadingDatabases, setLoadingDatabases] = useState(false);
  const [dumpingDatabase, setDumpingDatabase] = useState<string | null>(null);
  const [dumpProgress, setDumpProgress] = useState<DumpProgress | null>(null);

  // Restore flow state — admin-only dialog. Stages: idle → uploading → restoring
  // → success | error. uploading drives the progress bar; restoring is the gap
  // between upload finish and server response (no progress, just a spinner).
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreTarget, setRestoreTarget] = useState('');
  const [restoreStage, setRestoreStage] = useState<'idle' | 'uploading' | 'restoring' | 'success' | 'error'>('idle');
  const [restoreProgress, setRestoreProgress] = useState<{ uploaded: number; total: number } | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  // Search filters — case-insensitive substring match on the visible name.
  const [containerSearch, setContainerSearch] = useState('');
  const [databaseSearch, setDatabaseSearch] = useState('');
  const filteredContainers = containers.filter((c) => {
    const q = containerSearch.trim().toLowerCase();
    return !q || c.name.toLowerCase().includes(q);
  });
  const filteredDatabases = databases.filter((d) => {
    const q = databaseSearch.trim().toLowerCase();
    return !q || d.name.toLowerCase().includes(q) || (d.owner ?? '').toLowerCase().includes(q);
  });

  // Compose-project context for the selected postgres container — which app
  // uses it, which DB is live, project path, etc. Null while loading or when
  // the container isn't compose-managed; renders the context strip when set.
  const [containerContext, setContainerContext] = useState<PostgresContainerContext | null>(null);
  // True while the context call is in flight. The working view's layout depends
  // on which DB is "live" (from context), so we hold the skeleton until context
  // resolves — otherwise the grid renders the no-live layout first and visibly
  // snaps into the two-column layout once context arrives.
  const [contextLoading, setContextLoading] = useState(false);

  // Admin-configured per-container credentials (used for hardened images that
  // removed the default "postgres" role). Keyed by container name.
  const [credentials, setCredentials] = useState<PostgresCredential[]>([]);
  const [credExpanded, setCredExpanded] = useState(false);
  const [credUser, setCredUser] = useState('');
  const [credDbName, setCredDbName] = useState('');
  const [credPassword, setCredPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (selectedServer) {
      loadContainers();
    }
  }, [selectedServer]);

  useEffect(() => {
    if (selectedServer && selectedContainer) {
      loadDatabases();
      // Fetch the compose-project context in parallel. We track its loading
      // separately so the working view can wait for it before choosing a layout.
      setContainerContext(null);
      setContextLoading(true);
      getContainerContext(selectedServer, selectedContainer)
        .then(setContainerContext)
        .finally(() => setContextLoading(false));
    }
  }, [selectedContainer]);

  const loadContainers = async () => {
    setLoadingContainers(true);
    try {
      const [data, creds] = await Promise.all([
        getContainers(selectedServer),
        getCredentials(selectedServer),
      ]);
      setContainers(data);
      setCredentials(creds);
      if (data.length > 0 && !selectedContainer) {
        setSelectedContainer(data[0].id);
      }
      setDatabases([]);
    } catch (error) {
      console.error('Failed to load containers:', error);
    } finally {
      setLoadingContainers(false);
    }
  };

  const loadDatabases = async () => {
    // Wipe the grid immediately so a switch/refresh never shows the previous
    // container's databases while loading or after a failure.
    setDatabases([]);
    setLoadingDatabases(true);
    try {
      const containerName = containers.find((c) => c.id === selectedContainer)?.name;
      const data = await getDatabases(selectedServer, selectedContainer, containerName);
      setDatabases(data);
    } catch (error) {
      console.error('Failed to load databases:', error);
      // On any failure (e.g. 500 "role postgres does not exist") keep the grid
      // empty — never preserve stale data.
      setDatabases([]);
    } finally {
      setLoadingDatabases(false);
    }
  };

  const handleDump = async (databaseName: string, dbSize?: string) => {
    setDumpingDatabase(databaseName);
    // Seed the progress bar with the parsed db.size as the expected total so
    // the user sees a real percentage immediately, not an indeterminate sweep.
    const estimatedTotal = parseSizeToBytes(dbSize);
    setDumpProgress({ received: 0, total: estimatedTotal });
    if (!selectedServer || !selectedContainer || !databaseName) {
      setDumpingDatabase(null);
      setDumpProgress(null);
      return;
    }

    try {
      const blob = await createDump(
        {
          server_id: selectedServer,
          container_id: selectedContainer,
          database: databaseName,
          container_name: selectedContainerData?.name,
        },
        {
          // If the server ever sets Content-Length, prefer that exact value;
          // otherwise keep the db.size estimate so the bar still advances.
          onProgress: (received, total) =>
            setDumpProgress({ received, total: total ?? estimatedTotal }),
        },
      );

      const containerName = selectedContainerData?.name || 'unknown';
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0];
      const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
      const filename = `${containerName}_${databaseName}_${dateStr}_${timeStr}.sql`;

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      // A successful dump bumps every aggregate (most-dumped, top users,
      // monthly total, today's trend bucket) — refresh the strip in the
      // background so the next render reflects it.
      reloadDumpStats();
    } catch (error) {
      console.error('Failed to create dump:', error);
    } finally {
      setDumpingDatabase(null);
      setDumpProgress(null);
    }
  };

  const selectedContainerData = containers.find((c) => c.id === selectedContainer);
  const currentCred = credentials.find((c) => c.containerName === selectedContainerData?.name);

  // Wipe the restore form back to a clean idle state (used on close and on
  // success after a short delay).
  const resetRestoreForm = () => {
    setRestoreFile(null);
    setRestoreTarget('');
    setRestoreStage('idle');
    setRestoreProgress(null);
    setRestoreError(null);
  };

  // Suggest a safe target name from the picked filename so users get a sensible
  // default that doesn't clash. Our dumps are formatted "<dbname>-<timestamp>.sql"
  // (see CreatePostgresDump controller) — strip extension, take the part before
  // the first "-", and append "_restored".
  const suggestTargetName = (filename: string): string => {
    const stem = filename.replace(/\.(sql\.gz|sql|gz)$/i, '');
    const dbPart = stem.split('-')[0];
    return dbPart ? `${dbPart}_restored` : '';
  };

  const handleRestoreFilePick = (file: File | null) => {
    setRestoreFile(file);
    setRestoreError(null);
    if (file && !restoreTarget) {
      setRestoreTarget(suggestTargetName(file.name));
    }
  };

  const handleRestoreSubmit = async () => {
    if (!restoreFile || !restoreTarget.trim() || !selectedServer || !selectedContainer) return;
    setRestoreStage('uploading');
    setRestoreProgress({ uploaded: 0, total: restoreFile.size });
    setRestoreError(null);
    try {
      await restoreDump(
        {
          serverId: selectedServer,
          containerId: selectedContainer,
          containerName: selectedContainerData?.name,
          targetDatabase: restoreTarget.trim(),
          file: restoreFile,
        },
        {
          onProgress: (uploaded, total) => {
            setRestoreProgress({ uploaded, total });
            // Upload phase done — server is now running createdb + psql.
            if (uploaded >= total) setRestoreStage('restoring');
          },
        },
      );
      setRestoreStage('success');
      // Refresh the database grid so the freshly-restored DB shows up.
      await loadDatabases();
      // Auto-close after a short pause so the success state is visible.
      setTimeout(() => {
        setRestoreOpen(false);
        resetRestoreForm();
      }, 1400);
    } catch (err) {
      setRestoreStage('error');
      setRestoreError(err instanceof Error ? err.message : 'Restore failed');
    }
  };

  // Sync the credential form to the selected container. Password stays blank
  // (write-only); `hasPassword` on currentCred indicates a stored secret.
  useEffect(() => {
    setCredUser(currentCred?.dbUser || '');
    setCredDbName(currentCred?.dbName || 'postgres');
    setCredPassword('');
    setShowPassword(false);
    setCredExpanded(false);
  }, [selectedContainer, selectedContainerData?.name, currentCred?.dbUser, currentCred?.dbName]);

  const handleSaveCredentials = async () => {
    if (!selectedContainerData || !credUser.trim() || !credDbName.trim()) return;
    const ok = await saveCredential(selectedServer, {
      containerName: selectedContainerData.name,
      dbUser: credUser.trim(),
      dbName: credDbName.trim(),
      dbPassword: credPassword || undefined,
    });
    if (ok) {
      setCredentials(await getCredentials(selectedServer));
      setCredPassword('');
      setCredExpanded(false);
      loadDatabases();
    }
  };

  const handleClearCredentials = async () => {
    if (!selectedContainerData) return;
    const ok = await deleteCredential(selectedServer, selectedContainerData.name);
    if (ok) {
      setCredentials(await getCredentials(selectedServer));
      setCredUser('');
      setCredDbName('');
      setCredPassword('');
      loadDatabases();
    }
  };

  const serverStatus = (s: (typeof servers)[number]) =>
    s.status === 'online' ? 'online' : s.status === 'checking' ? 'idle' : 'offline';

  // Split the (filtered) databases into the in-use ("Live") set — the ones a
  // sibling app container actually connects to — and everything else. The
  // working view shows the used database on its own (left) and the rest beside
  // the project info (right).
  const liveDbSet = new Set(containerContext?.activeDatabases ?? []);
  const liveDatabases = filteredDatabases.filter((d) => liveDbSet.has(d.name));
  const otherDatabases = filteredDatabases.filter((d) => !liveDbSet.has(d.name));

  // renderDbCard — the indigo database tile, shared by both columns so the live
  // and "other" grids render identically. Closes over the dump progress state.
  const renderDbCard = (db: PostgresDatabase) => {
    const isDumping = dumpingDatabase === db.name;
    const isLive = liveDbSet.has(db.name);
    // Progress percentage only known when Content-Length is set; otherwise we
    // render an indeterminate sweep below.
    const pct =
      isDumping && dumpProgress && dumpProgress.total
        ? Math.min(100, Math.round((dumpProgress.received / dumpProgress.total) * 100))
        : null;
    return (
      // Outer chassis — soft frame around the gradient indigo canvas, with hover lift.
      <div
        key={db.name}
        className={`lift rounded-[22px] border bg-[var(--card)] p-2 flex flex-col hover:-translate-y-1 [--lift-glow:0_14px_32px_rgba(65,51,255,0.10)] ${isLive ? 'live-glow' : ''}`}
        style={{
          // Live DBs get a soft indigo hairline under the animated snake border
          // (same family as the card); everything else stays neutral.
          borderColor: isLive ? 'color-mix(in srgb, #5b4dff 45%, var(--border))' : 'var(--border)',
        }}
        title={isLive ? `In use by an app container in this compose project` : undefined}
      >
        {/* Display canvas — gradient indigo with subtle top sheen for depth. */}
        <div
          className="relative rounded-[16px] px-4 py-4 flex flex-col overflow-hidden"
          style={{ background: 'linear-gradient(160deg, #5b4dff 0%, #4133ff 55%, #2e22d4 100%)' }}
        >
          {/* Glossy top sheen */}
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-[40%] pointer-events-none"
            style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.12) 0%, transparent 100%)' }}
          />

          {/* Top row: Active status pill (+ Live pill) + Database icon chip. */}
          <div className="relative flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-[#1A1A1E] shadow-[0_2px_6px_rgba(0,0,0,0.08)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-green)]" />
                Active
              </span>
              {isLive && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-green)] px-2.5 py-1 text-[11px] font-bold text-white shadow-[0_2px_6px_rgba(0,0,0,0.10)]"
                  title="This database is referenced by an app container in this compose project."
                >
                  <Sparkles className="h-3 w-3" />
                  Live
                </span>
              )}
            </div>
            <span className="grid h-7 w-7 place-items-center rounded-full bg-white/20 text-white">
              <Database className="h-3.5 w-3.5" />
            </span>
          </div>

          {/* Owner eyebrow + DB name title */}
          <p className="relative text-[11px] font-medium text-white/65 mb-0.5 truncate uppercase tracking-wider">
            {db.owner}
          </p>
          <h3 className="relative text-[22px] font-bold leading-[1.15] tracking-tight text-white line-clamp-2 break-all mb-3">
            {db.name}
          </h3>

          {/* Encoding + engine pills (translucent on indigo) */}
          <div className="relative flex flex-wrap gap-1.5">
            <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-white/15 border border-white/25 text-white">
              {db.encoding || 'UTF8'}
            </span>
            <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-white/15 border border-white/25 text-white">
              PostgreSQL
            </span>
          </div>
        </div>

        {/* Footer — either size + Download CTA, or progress UI while dumping. */}
        <div className="px-2.5 pt-3 pb-1.5">
          {isDumping ? (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[12px] font-semibold text-[var(--ink)] inline-flex items-center gap-2">
                  <Download className="h-3.5 w-3.5" />
                  Downloading
                  {pct !== null && <span className="tabular-nums">{pct}%</span>}
                </span>
                <span className="text-[11px] tabular-nums text-[var(--ink-muted)]">
                  {dumpProgress ? formatBytes(dumpProgress.received) : '—'}
                  {dumpProgress?.total ? ` / ${formatBytes(dumpProgress.total)}` : ''}
                </span>
              </div>
              {/* Progress bar — determinate when total is known, indeterminate sweep otherwise. */}
              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(65,51,255,0.10)' }}>
                {pct !== null ? (
                  <div
                    className="h-full w-full origin-left rounded-full transition-transform duration-150 ease-out"
                    style={{ transform: `scaleX(${pct / 100})`, background: 'linear-gradient(90deg, #5b4dff, #4133ff)' }}
                  />
                ) : (
                  <div className="h-full rounded-full pg-dump-indeterminate" />
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col gap-0 min-w-0">
                <span className="text-[18px] font-bold tracking-tight tabular-nums text-[var(--ink)] leading-tight">
                  {db.size || 'N/A'}
                </span>
                <span className="text-[11px] text-[var(--ink-muted)] uppercase tracking-wider">Database size</span>
              </div>
              <button
                type="button"
                onClick={() => handleDump(db.name, db.size)}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] text-[var(--card)] px-5 py-3 text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed shadow-[0_6px_16px_rgba(0,0,0,0.18)]"
              >
                <Download className="h-4 w-4" />
                Download
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Minimal project summary — quiet by design (point: "there but not the hero").
  // A compact warm strip: project + path on one line, consumers as small dots.
  // Project summary — a quiet white panel (the section label above names it).
  // h-full + a flex services list that distributes down the panel so it fills
  // the height of the in-use card beside it rather than leaving dead space.
  const projectStrip = containerContext?.hasProject ? (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card-warm)] p-4 h-full flex flex-col">
      {/* Header — project name + path */}
      <div className="flex items-center gap-2 min-w-0 shrink-0">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--accent-pink-soft)] text-[var(--accent-pink)] shrink-0">
          <FolderOpen className="h-4 w-4" />
        </span>
        <span className="font-bold text-[var(--ink)] text-sm truncate">{containerContext.project}</span>
        {containerContext.workingDir && (
          <span className="font-mono text-[11px] text-[var(--ink-muted)] truncate hidden sm:inline" title={containerContext.workingDir}>
            {containerContext.workingDir}
          </span>
        )}
      </div>

      {(containerContext.consumers ?? []).length > 0 ? (
        <>
          <div className="flex items-baseline justify-between mt-3 mb-1 shrink-0">
            <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--ink-muted)]">Used by</span>
            <span className="text-[11px] text-[var(--ink-muted)] tabular-nums">{(containerContext.consumers ?? []).length} services</span>
          </div>
          {/* Service rows spread to fill the remaining height. */}
          <div className="flex-1 flex flex-col justify-between min-h-0">
            {(containerContext.consumers ?? []).map((cn) => {
              const kindColor = cn.kind === 'frontend' ? '#4285F4' : cn.kind === 'backend' ? 'var(--accent-pink)' : 'var(--ink-muted)';
              const serverAddr = servers.find((s) => s.id === selectedServer)?.address ?? '';
              const ports = cn.ports ?? [];
              const databases = cn.databases ?? [];
              const url = cn.domain ? `https://${cn.domain}` : (ports[0] ? `http://${serverAddr}:${ports[0]}` : '');
              const endpoint = cn.domain ?? (ports[0] ? `:${ports.join(', :')}` : '');
              const tip = [cn.kind, url, databases.length ? `db: ${databases.join(', ')}` : '']
                .filter(Boolean)
                .join('  ·  ');
              return (
                <div key={cn.id} title={tip} className="flex items-center gap-2 min-w-0 text-xs py-1 cursor-default border-t border-[var(--border)] first:border-t-0">
                  <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: kindColor }} />
                  <span className="font-semibold text-[var(--ink)] truncate">{cn.name}</span>
                  <span
                    className="text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded shrink-0"
                    style={{ background: `color-mix(in srgb, ${kindColor} 14%, transparent)`, color: kindColor }}
                  >
                    {cn.kind}
                  </span>
                  <span className="ml-auto flex items-center gap-1 min-w-0 shrink justify-end font-mono text-[var(--ink-muted)]">
                    {databases.length > 0 ? (
                      <>
                        <Database className="h-3 w-3 text-[var(--accent-green)] shrink-0" />
                        <span className="truncate text-[var(--ink)] font-semibold">{databases.join(', ')}</span>
                      </>
                    ) : endpoint ? (
                      <span className="truncate">{endpoint}</span>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <p className="text-xs text-[var(--ink-muted)] italic mt-3">No sibling containers detected in this compose project.</p>
      )}
    </div>
  ) : null;

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
            Add a server from the Infrastructure page to manage PostgreSQL containers and databases.
          </p>
        </div>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-6">
      {/* Aggregate insights — shown on the landing/picker view only so the
          working view stays focused. Hidden while drilled into a server. */}
      {!selectedServer && (
        <DumpStatsStrip stats={dumpStats} loading={dumpStatsLoading} />
      )}

      {/* Server Selection — cards */}
      {!selectedServer && (
        <GlassCard>
          <div className="flex items-center gap-4 mb-6">
            <div className="h-12 w-12 rounded-2xl bg-[var(--accent-pink-soft)] flex items-center justify-center">
              <Database className="h-6 w-6 text-[var(--ink)]" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-[var(--ink)]">PostgreSQL Containers</h2>
              <p className="text-[var(--ink-muted)] text-sm">Select a server to view its PostgreSQL containers</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {servers.map((server) => (
              <ServerPickerCard
                key={server.id}
                name={server.name}
                address={server.address}
                status={server.status === 'online' ? 'online' : server.status === 'checking' ? 'checking' : 'offline'}
                stats={serverStats[server.id]}
                onClick={() => setSelectedServer(server.id)}
              />
            ))}
          </div>
        </GlassCard>
      )}

      {/* Split Pane Layout */}
      {selectedServer && (
        <GlassCard className="p-0 overflow-hidden">
          {/* Header */}
          <div className="p-6 border-b border-[var(--border)]">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-2xl bg-[var(--accent-pink-soft)] flex items-center justify-center">
                <Database className="h-6 w-6 text-[var(--ink)]" />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-semibold text-[var(--ink)]">PostgreSQL Containers</h2>
                <p className="text-[var(--ink-muted)] text-sm">
                  {servers.find((s) => s.id === selectedServer)?.name || 'Server'}
                </p>
              </div>
              <AccentButton
                variant="ghost"
                onClick={() => {
                  setSelectedServer('');
                  setSelectedContainer('');
                  setContainers([]);
                  setDatabases([]);
                }}
              >
                Change Server
              </AccentButton>
            </div>
          </div>

          {/* Split Pane Content */}
          <div className="flex h-[600px]">
            {/* Left Sidebar - Container List */}
            <div className="w-80 border-r border-[var(--border)] bg-[var(--card-warm)] flex flex-col min-h-0">
              {/* Sticky search header (hidden until containers loaded). */}
              {containers.length > 0 && (
                <div className="p-2 border-b border-[var(--border)] shrink-0">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ink-muted)] pointer-events-none" />
                    <input
                      type="text"
                      value={containerSearch}
                      onChange={(e) => setContainerSearch(e.target.value)}
                      placeholder="Search containers…"
                      className="w-full h-9 pl-9 pr-3 rounded-lg bg-[var(--card)] border border-[var(--border)] text-sm text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:outline-none focus:border-[var(--ink)]/30 transition-colors"
                    />
                  </div>
                </div>
              )}
              <ScrollArea className="flex-1 min-h-0">
                <div className="p-2">
                  {loadingContainers ? (
                    <div className="p-2 space-y-2">
                      <GlassSkeleton.Row count={4} />
                    </div>
                  ) : containers.length === 0 ? (
                    <div className="text-center py-12 px-4">
                      <Container className="h-12 w-12 text-[var(--ink-muted)] mx-auto mb-3" />
                      <p className="text-sm text-[var(--ink-muted)]">No containers found</p>
                    </div>
                  ) : filteredContainers.length === 0 ? (
                    <div className="text-center py-10 px-4 text-sm text-[var(--ink-muted)]">
                      No containers match "{containerSearch}".
                    </div>
                  ) : (
                    filteredContainers.map((container) => {
                      const isSelected = selectedContainer === container.id;
                      const { duration, health } = parseContainerStatus(container.status);
                      const hasCustomCred = credentials.some((c: PostgresCredential) => c.containerName === container.name);
                      // Deterministic per-container accent color so each row is scannable.
                      const idColor = containerColor(container.name);
                      return (
                        <button
                          key={container.id}
                          onClick={() => {
                            if (container.id === selectedContainer) return;
                            // Clear the grid on selection so the previous container's
                            // databases vanish instantly (before the fetch effect runs).
                            setDatabases([]);
                            setSelectedContainer(container.id);
                          }}
                          className="w-full text-left p-2.5 rounded-xl mb-1 transition-[background-color,border-color,color] duration-150 ease-[cubic-bezier(0.4,0,0.2,1)] relative focus-ring-cyan flex items-center gap-3 border"
                          style={{
                            // Selected = a solid surface gently washed with the container's
                            // own accent (gradient → card), so it reads as a raised tile in
                            // both light and dark instead of a flat translucent tint.
                            background: isSelected
                              ? `linear-gradient(135deg, color-mix(in srgb, ${idColor} 13%, var(--card)) 0%, var(--card) 78%)`
                              : 'transparent',
                            borderColor: isSelected ? `color-mix(in srgb, ${idColor} 32%, transparent)` : 'transparent',
                            boxShadow: isSelected ? `0 4px 14px color-mix(in srgb, ${idColor} 18%, transparent)` : 'none',
                          }}
                          onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'rgba(0,0,0,0.04)'; }}
                          onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                        >
                          {/* Icon chip — shared database glyph, per-container color.
                              Solid fill + colored glow when selected; soft tint otherwise. */}
                          <div
                            className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0 transition-colors"
                            style={
                              isSelected
                                ? { background: idColor, color: '#ffffff', boxShadow: `0 4px 12px color-mix(in srgb, ${idColor} 45%, transparent)` }
                                : { background: `color-mix(in srgb, ${idColor} 14%, transparent)`, color: idColor }
                            }
                          >
                            <Database className="h-4 w-4" />
                          </div>
                          {/* Name + status meta */}
                          <div className="flex-1 min-w-0">
                            <div
                              className="text-sm truncate"
                              style={{
                                // Selected name darkens the accent toward ink so it stays
                                // readable in both themes while echoing the chip color.
                                color: isSelected ? `color-mix(in srgb, ${idColor} 55%, var(--ink))` : 'var(--ink)',
                                fontWeight: isSelected ? 700 : 500,
                              }}
                            >
                              {container.name}
                            </div>
                            <div className="text-[11px] flex items-center gap-1.5 mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                              <span
                                className="h-1.5 w-1.5 rounded-full shrink-0"
                                style={{ background: HEALTH_DOT_COLOR[health] }}
                                aria-label={health === 'none' ? 'unknown' : health}
                              />
                              <span className="truncate">{duration}</span>
                              {hasCustomCred && (
                                <>
                                  <span className="opacity-50">·</span>
                                  <span className="inline-flex items-center gap-0.5 text-[var(--accent-green)]" title="Custom credentials configured">
                                    <KeyRound className="h-2.5 w-2.5" />
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                          {isSelected && <ChevronRight className="h-4 w-4 shrink-0" style={{ color: idColor }} />}
                        </button>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </div>

            {/* Right Main Content - Database Cards */}
            <div className="flex-1 overflow-hidden">
              <ScrollArea className="h-full">
                <div className="p-6">
                  {selectedContainerData ? (
                    <>
                      {/* Container Header */}
                      <div className="mb-6 flex items-start justify-between gap-4">
                        <div>
                          <h3 className="mb-1 text-lg font-semibold text-[var(--ink)]">{selectedContainerData.name}</h3>
                          <p className="text-sm text-[var(--ink-muted)]">PostgreSQL databases inside this container</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {/* Restore — admin-only; creates a NEW database with a user-chosen name. */}
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => { resetRestoreForm(); setRestoreOpen(true); }}
                              className="flex items-center gap-2 h-9 px-3 rounded-[var(--radius)] border border-[var(--border)] text-sm text-[var(--ink)] hover:bg-black/[0.03] transition-colors focus:outline-none"
                              title="Restore a dump into a new database"
                            >
                              <Upload className="h-4 w-4 text-[var(--ink-muted)]" />
                              Restore
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setCredExpanded((v) => !v)}
                            className="flex items-center gap-2 h-9 px-3 rounded-[var(--radius)] border border-[var(--border)] text-sm text-[var(--ink)] hover:bg-black/[0.03] transition-colors focus:outline-none"
                          >
                            <KeyRound className="h-4 w-4 text-[var(--ink-muted)]" />
                            Credentials
                            {currentCred && (
                              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-green)]" title="Custom credentials configured" />
                            )}
                          </button>
                        </div>
                      </div>

                      {/* DB Credentials dialog — explicit user / password / maintenance DB
                          for hardened containers without the default "postgres" role.
                          Saved encrypted per container; used instead of auto-detection. */}
                      <Dialog open={credExpanded} onOpenChange={setCredExpanded}>
                        <DialogContent className="bento-card sm:max-w-[440px]">
                          <DialogHeader>
                            <DialogTitle>Database Credentials</DialogTitle>
                            <DialogDescription>
                              For <span className="font-medium text-[var(--ink)]">{selectedContainerData.name}</span>. Stored encrypted, per container — used instead of auto-detecting the superuser.
                            </DialogDescription>
                          </DialogHeader>

                          <div className="space-y-4">
                            <div>
                              <label htmlFor="cred-user" className="block text-xs font-medium text-[var(--ink-muted)] mb-1">
                                Database User
                              </label>
                              <input
                                id="cred-user"
                                type="text"
                                value={credUser}
                                onChange={(e) => setCredUser(e.target.value)}
                                placeholder="e.g. nexgensis"
                                spellCheck={false}
                                autoCapitalize="off"
                                autoCorrect="off"
                                className="w-full h-9 px-3 text-sm text-[var(--ink)] bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius)] placeholder:text-[var(--ink-muted)] focus:outline-none focus:border-[var(--ink)]/30 transition-colors"
                              />
                            </div>

                            <div>
                              <label htmlFor="cred-password" className="block text-xs font-medium text-[var(--ink-muted)] mb-1">
                                Database Password
                              </label>
                              <div className="relative">
                                <input
                                  id="cred-password"
                                  type={showPassword ? 'text' : 'password'}
                                  value={credPassword}
                                  onChange={(e) => setCredPassword(e.target.value)}
                                  placeholder={currentCred?.hasPassword ? '•••••••• (unchanged)' : 'Enter password'}
                                  spellCheck={false}
                                  autoComplete="new-password"
                                  className="w-full h-9 pl-3 pr-9 text-sm text-[var(--ink)] bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius)] placeholder:text-[var(--ink-muted)] focus:outline-none focus:border-[var(--ink)]/30 transition-colors"
                                />
                                <button
                                  type="button"
                                  onClick={() => setShowPassword((v) => !v)}
                                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors focus:outline-none"
                                >
                                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </button>
                              </div>
                            </div>

                            <div>
                              <label htmlFor="cred-dbname" className="block text-xs font-medium text-[var(--ink-muted)] mb-1">
                                Maintenance / Default Database
                              </label>
                              <input
                                id="cred-dbname"
                                type="text"
                                value={credDbName}
                                onChange={(e) => setCredDbName(e.target.value)}
                                placeholder="postgres"
                                spellCheck={false}
                                autoCapitalize="off"
                                autoCorrect="off"
                                className="w-full h-9 px-3 text-sm text-[var(--ink)] bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius)] placeholder:text-[var(--ink-muted)] focus:outline-none focus:border-[var(--ink)]/30 transition-colors"
                              />
                            </div>
                          </div>

                          <DialogFooter>
                            {currentCred && (
                              <AccentButton variant="ghost" onClick={handleClearCredentials} disabled={loading}>
                                Remove
                              </AccentButton>
                            )}
                            <AccentButton
                              variant="lime"
                              onClick={handleSaveCredentials}
                              disabled={loading || !credUser.trim() || !credDbName.trim()}
                            >
                              Save Credentials
                            </AccentButton>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>

                      {/* Restore Dialog — admin only. Creates a fresh database from an uploaded
                          .sql / .sql.gz dump. Refuses if target name already exists (server-side
                          409) so live databases are never silently overwritten. */}
                      <Dialog
                        open={restoreOpen}
                        onOpenChange={(open) => {
                          // Block close while upload/restore is in flight so the user can't
                          // accidentally orphan a half-uploaded transfer.
                          if (!open && (restoreStage === 'uploading' || restoreStage === 'restoring')) return;
                          setRestoreOpen(open);
                          if (!open) resetRestoreForm();
                        }}
                      >
                        <DialogContent className="bento-card sm:max-w-[480px]">
                          <DialogHeader>
                            <DialogTitle>Restore Database</DialogTitle>
                            <DialogDescription>
                              Upload a <span className="font-mono text-[var(--ink)]">.sql</span> or <span className="font-mono text-[var(--ink)]">.sql.gz</span> dump and pick a name for the <strong>new</strong> database in <span className="font-medium text-[var(--ink)]">{selectedContainerData.name}</span>. If the target name already exists, the restore is refused — your live database is never touched.
                            </DialogDescription>
                          </DialogHeader>

                          <div className="space-y-4">
                            {/* File picker — clickable area with hidden input */}
                            <div>
                              <label htmlFor="restore-file" className="block text-xs font-medium text-[var(--ink-muted)] mb-1">
                                Dump file
                              </label>
                              <label
                                htmlFor="restore-file"
                                className={`flex flex-col items-center justify-center gap-2 rounded-[var(--radius)] border-2 border-dashed px-4 py-6 cursor-pointer transition-colors ${
                                  restoreFile
                                    ? 'border-[var(--accent-pink)]/40 bg-[var(--accent-pink-soft)]'
                                    : 'border-[var(--border)] hover:bg-black/[0.02]'
                                } ${restoreStage === 'uploading' || restoreStage === 'restoring' ? 'pointer-events-none opacity-60' : ''}`}
                              >
                                {restoreFile ? (
                                  <>
                                    <FileUp className="h-6 w-6 text-[var(--accent-pink)]" />
                                    <div className="text-center min-w-0">
                                      <div className="text-sm font-medium text-[var(--ink)] truncate max-w-[20rem]">{restoreFile.name}</div>
                                      <div className="text-xs text-[var(--ink-muted)] mt-0.5">{formatBytes(restoreFile.size)} · click to change</div>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <Upload className="h-6 w-6 text-[var(--ink-muted)]" />
                                    <div className="text-center">
                                      <div className="text-sm text-[var(--ink)]">Click to pick a dump file</div>
                                      <div className="text-xs text-[var(--ink-muted)] mt-0.5">.sql or .sql.gz — any size</div>
                                    </div>
                                  </>
                                )}
                                <input
                                  id="restore-file"
                                  type="file"
                                  accept=".sql,.gz,.sql.gz,application/sql,application/gzip,application/x-gzip"
                                  className="hidden"
                                  disabled={restoreStage === 'uploading' || restoreStage === 'restoring'}
                                  onChange={(e) => handleRestoreFilePick(e.target.files?.[0] ?? null)}
                                />
                              </label>
                            </div>

                            {/* Target database name */}
                            <div>
                              <label htmlFor="restore-target" className="block text-xs font-medium text-[var(--ink-muted)] mb-1">
                                Target database name <span className="text-[var(--accent-destructive)]">*</span>
                              </label>
                              <input
                                id="restore-target"
                                type="text"
                                value={restoreTarget}
                                onChange={(e) => setRestoreTarget(e.target.value)}
                                placeholder="e.g. qms_restored"
                                spellCheck={false}
                                autoCapitalize="off"
                                autoCorrect="off"
                                disabled={restoreStage === 'uploading' || restoreStage === 'restoring'}
                                className="w-full h-9 px-3 text-sm text-[var(--ink)] bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius)] placeholder:text-[var(--ink-muted)] focus:outline-none focus:border-[var(--ink)]/30 transition-colors disabled:opacity-60"
                              />
                              <p className="text-[11px] text-[var(--ink-muted)] mt-1">
                                Letters, digits, underscore, hyphen. Must not exist on this container.
                              </p>
                            </div>

                            {/* Progress / status banner */}
                            {restoreStage === 'uploading' && restoreProgress && (
                              <div>
                                <div className="flex items-center justify-between mb-1.5 text-xs">
                                  <span className="font-medium text-[var(--ink)]">Uploading…</span>
                                  <span className="tabular-nums text-[var(--ink-muted)]">
                                    {formatBytes(restoreProgress.uploaded)} / {formatBytes(restoreProgress.total)}
                                    {' · '}
                                    {Math.round((restoreProgress.uploaded / Math.max(1, restoreProgress.total)) * 100)}%
                                  </span>
                                </div>
                                <div className="h-2 rounded-full overflow-hidden bg-[var(--card-warm)]">
                                  <div
                                    className="h-full w-full origin-left rounded-full transition-transform duration-150 ease-out"
                                    style={{
                                      transform: `scaleX(${Math.min(100, Math.round((restoreProgress.uploaded / Math.max(1, restoreProgress.total)) * 100)) / 100})`,
                                      background: 'var(--accent-pink)',
                                    }}
                                  />
                                </div>
                              </div>
                            )}
                            {restoreStage === 'restoring' && (
                              <div className="flex items-center gap-2 text-sm text-[var(--ink)]">
                                <span className="h-4 w-4 rounded-full border-2 border-[var(--accent-pink)] border-r-transparent animate-spin" />
                                <span>Restoring on server (running <span className="font-mono text-xs">psql</span>)…</span>
                              </div>
                            )}
                            {restoreStage === 'success' && (
                              <div className="flex items-start gap-2 rounded-[var(--radius)] border border-[color-mix(in_srgb,var(--accent-green)_30%,transparent)] bg-[var(--accent-green-soft)] px-3 py-2 text-sm text-[var(--ink)]">
                                <Database className="h-4 w-4 mt-0.5 shrink-0 text-[var(--accent-green)]" />
                                <span>Database <span className="font-mono">{restoreTarget}</span> restored.</span>
                              </div>
                            )}
                            {restoreStage === 'error' && restoreError && (
                              <div className="flex items-start gap-2 rounded-[var(--radius)] border border-[color-mix(in_srgb,var(--accent-destructive)_30%,transparent)] bg-[var(--accent-destructive-soft)] px-3 py-2 text-sm text-[var(--ink)]">
                                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-[var(--accent-destructive)]" />
                                <span>{restoreError}</span>
                              </div>
                            )}
                          </div>

                          <DialogFooter>
                            <AccentButton
                              variant="ghost"
                              onClick={() => { setRestoreOpen(false); resetRestoreForm(); }}
                              disabled={restoreStage === 'uploading' || restoreStage === 'restoring'}
                            >
                              {restoreStage === 'success' ? 'Close' : 'Cancel'}
                            </AccentButton>
                            <AccentButton
                              variant="lime"
                              onClick={handleRestoreSubmit}
                              disabled={
                                !restoreFile ||
                                !restoreTarget.trim() ||
                                restoreStage === 'uploading' ||
                                restoreStage === 'restoring' ||
                                restoreStage === 'success'
                              }
                            >
                              {restoreStage === 'uploading' || restoreStage === 'restoring' ? (
                                <span className="h-4 w-4 rounded-full border-2 border-current border-r-transparent animate-spin" />
                              ) : (
                                <Upload className="h-4 w-4" />
                              )}
                              Restore
                            </AccentButton>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>

                      {/* Working area — left: the in-use database on its own; right:
                          a minimal project summary with the other databases under it.
                          We hold the skeleton until BOTH databases and context have
                          loaded, so the layout never snaps from no-live to two-column. */}
                      {loadingDatabases || contextLoading ? (
                        // Skeleton mirrors the working layout (matched pair on top, then
                        // a full-width grid) so the shape doesn't jump when cards land.
                        <div className="space-y-5">
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                            <div className="space-y-3">
                              <GlassSkeleton className="h-3 w-16 rounded" />
                              <GlassSkeleton.Card count={1} />
                            </div>
                            <div className="space-y-3">
                              <GlassSkeleton className="h-3 w-16 rounded" />
                              <GlassSkeleton.Card count={1} />
                            </div>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                            <GlassSkeleton.Card count={3} />
                          </div>
                        </div>
                      ) : databases.length === 0 ? (
                        <div className="text-center py-16">
                          <Database className="h-16 w-16 text-[var(--ink-muted)] mx-auto mb-4" />
                          <p className="text-[var(--ink-muted)]">No databases found in this container</p>
                        </div>
                      ) : (
                        <>
                          {/* Database search */}
                          <div className="relative mb-5 max-w-md">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ink-muted)] pointer-events-none" />
                            <input
                              type="text"
                              value={databaseSearch}
                              onChange={(e) => setDatabaseSearch(e.target.value)}
                              placeholder="Search databases by name or owner…"
                              className="w-full h-10 pl-9 pr-3 rounded-xl bg-[var(--card)] border border-[var(--border)] text-sm text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:outline-none focus:border-[var(--ink)]/30 transition-colors"
                            />
                          </div>

                          {filteredDatabases.length === 0 ? (
                            <div className="text-center py-12 text-sm text-[var(--ink-muted)]">
                              No databases match "{databaseSearch}".
                            </div>
                          ) : liveDatabases.length > 0 ? (
                            <div className="space-y-5">
                              {/* Top row — the in-use database and the project sit side by
                                  side at equal width and height, so they read as a matched
                                  pair. The project panel stretches (h-full) to the card. */}
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
                                {/* In use */}
                                <div className="flex flex-col gap-3 min-w-0">
                                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-[var(--ink-muted)]">
                                    <Sparkles className="h-3 w-3 text-[var(--accent-green)]" />
                                    In use
                                  </div>
                                  {liveDatabases.map(renderDbCard)}
                                </div>
                                {/* Project */}
                                <div className="flex flex-col gap-3 min-w-0">
                                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-[var(--ink-muted)]">
                                    <FolderOpen className="h-3 w-3" />
                                    Project
                                  </div>
                                  {projectStrip}
                                </div>
                              </div>
                              {/* Other databases — full width below the matched pair */}
                              {otherDatabases.length > 0 && (
                                <div>
                                  <div className="flex items-baseline justify-between mb-2.5">
                                    <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--ink-muted)]">Other databases</span>
                                    <span className="text-[11px] text-[var(--ink-muted)] tabular-nums">{otherDatabases.length}</span>
                                  </div>
                                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                                    {otherDatabases.map(renderDbCard)}
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : (
                            // No in-use database detected → quiet project summary, then
                            // every database in the usual full-width grid.
                            <div className="space-y-4">
                              {projectStrip}
                              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                                {otherDatabases.map(renderDbCard)}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-16">
                      <Container className="h-16 w-16 text-[var(--ink-muted)] mx-auto mb-4" />
                      <p className="text-[var(--ink-muted)]">Select a container to view databases</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        </GlassCard>
      )}
    </div>
  );
};
