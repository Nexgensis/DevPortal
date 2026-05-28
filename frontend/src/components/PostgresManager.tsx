import { useState, useEffect } from 'react';
import { usePostgres } from '../hooks/usePostgres';
import { useServers } from '../hooks/useServers';
import { useServerStats } from '../hooks/useServerStats';
import { PostgresContainer, PostgresDatabase, PostgresCredential } from '../types/postgres';
import { Database, Download, Server, Container, ChevronRight, KeyRound, Eye, EyeOff } from 'lucide-react';
import { ScrollArea } from './ui/scroll-area';
import { GlassCard } from './ui/glass-card';
import { AccentButton } from './ui/accent-button';
import { GlassSkeleton } from './ui/glass-skeleton';
import { StatusBadge } from './ui/status-badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { ServerPickerCard } from './ui/server-picker-card';

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

interface DumpProgress {
  received: number;
  total: number | null; // null = indeterminate (chunked transfer w/o Content-Length)
}

export const PostgresManager = () => {
  const { servers, isLoading: serversLoading } = useServers();
  const serverStats = useServerStats(servers);
  const { getContainers, getDatabases, createDump, getCredentials, saveCredential, deleteCredential, loading } = usePostgres();

  const [selectedServer, setSelectedServer] = useState<string>('');
  const [containers, setContainers] = useState<PostgresContainer[]>([]);
  const [selectedContainer, setSelectedContainer] = useState<string>('');
  const [databases, setDatabases] = useState<PostgresDatabase[]>([]);
  const [loadingContainers, setLoadingContainers] = useState(false);
  const [loadingDatabases, setLoadingDatabases] = useState(false);
  const [dumpingDatabase, setDumpingDatabase] = useState<string | null>(null);
  const [dumpProgress, setDumpProgress] = useState<DumpProgress | null>(null);

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
    } catch (error) {
      console.error('Failed to create dump:', error);
    } finally {
      setDumpingDatabase(null);
      setDumpProgress(null);
    }
  };

  const selectedContainerData = containers.find((c) => c.id === selectedContainer);
  const currentCred = credentials.find((c) => c.containerName === selectedContainerData?.name);

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

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 max-w-[1100px]">
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
            <div className="w-80 border-r border-[var(--border)] bg-[var(--card-warm)]">
              <ScrollArea className="h-full">
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
                  ) : (
                    containers.map((container) => {
                      const isSelected = selectedContainer === container.id;
                      const { duration, health } = parseContainerStatus(container.status);
                      const hasCustomCred = credentials.some((c: PostgresCredential) => c.containerName === container.name);
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
                          className="w-full text-left p-2.5 rounded-xl mb-1 transition-all relative focus-ring-cyan flex items-center gap-3 border"
                          style={{
                            // Indigo-tinted selected state matches the card identity.
                            background: isSelected ? 'rgba(91, 77, 255, 0.10)' : 'transparent',
                            borderColor: isSelected ? 'rgba(91, 77, 255, 0.28)' : 'transparent',
                            boxShadow: isSelected ? '0 2px 10px rgba(65, 51, 255, 0.08)' : 'none',
                          }}
                          onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'rgba(0,0,0,0.04)'; }}
                          onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                        >
                          {/* Accent rail visible only when selected */}
                          {isSelected && (
                            <span className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r-full" style={{ background: '#4133ff' }} />
                          )}
                          {/* Icon chip — solid indigo when selected, muted otherwise */}
                          <div
                            className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0 transition-colors"
                            style={
                              isSelected
                                ? { background: '#4133ff', color: '#ffffff' }
                                : { background: 'rgba(0,0,0,0.04)', color: 'var(--ink-muted)' }
                            }
                          >
                            <Database className="h-4 w-4" />
                          </div>
                          {/* Name + status meta */}
                          <div className="flex-1 min-w-0">
                            <div
                              className="text-sm truncate"
                              style={{
                                color: isSelected ? '#1e1b4b' : 'var(--ink)',
                                fontWeight: isSelected ? 700 : 500,
                              }}
                            >
                              {container.name}
                            </div>
                            <div className="text-[11px] flex items-center gap-1.5 mt-0.5" style={{ color: isSelected ? 'rgba(30,27,75,0.65)' : 'var(--ink-muted)' }}>
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
                          {isSelected && <ChevronRight className="h-4 w-4 shrink-0" style={{ color: '#4133ff' }} />}
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
                        <button
                          type="button"
                          onClick={() => setCredExpanded((v) => !v)}
                          className="flex items-center gap-2 h-9 px-3 rounded-[var(--radius)] border border-[var(--border)] text-sm text-[var(--ink)] hover:bg-black/[0.03] transition-colors focus:outline-none shrink-0"
                        >
                          <KeyRound className="h-4 w-4 text-[var(--ink-muted)]" />
                          Credentials
                          {currentCred && (
                            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-green)]" title="Custom credentials configured" />
                          )}
                        </button>
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

                      {/* Database Grid */}
                      {loadingDatabases ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                          <GlassSkeleton.Card count={3} />
                        </div>
                      ) : databases.length === 0 ? (
                        <div className="text-center py-16">
                          <Database className="h-16 w-16 text-[var(--ink-muted)] mx-auto mb-4" />
                          <p className="text-[var(--ink-muted)]">No databases found in this container</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                          {databases.map((db) => {
                            const isDumping = dumpingDatabase === db.name;
                            // Progress percentage only known when Content-Length is set;
                            // otherwise we render an indeterminate sweep below.
                            const pct =
                              isDumping && dumpProgress && dumpProgress.total
                                ? Math.min(100, Math.round((dumpProgress.received / dumpProgress.total) * 100))
                                : null;
                            return (
                              // Outer chassis — soft frame around the colored canvas. Flat, no animation.
                              <div
                                key={db.name}
                                className="rounded-[22px] border border-[var(--border)] bg-[var(--card)] p-2 flex flex-col"
                              >
                                {/* Display canvas — light pastel violet block, dark text. */}
                                <div
                                  className="rounded-[14px] px-3 py-3 flex flex-col"
                                  style={{ background: 'var(--accent-pink-soft)' }}
                                >
                                  {/* Top row: Active status pill + Database icon chip */}
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white border border-black/5 px-2.5 py-0.5 text-[11px] font-semibold text-[var(--ink)]">
                                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-green)]" />
                                      Active
                                    </span>
                                    <span className="grid h-6 w-6 place-items-center rounded-full bg-white text-[var(--accent-pink)]">
                                      <Database className="h-3.5 w-3.5" />
                                    </span>
                                  </div>

                                  {/* Owner eyebrow + DB name title */}
                                  <p className="text-[10px] font-medium text-[var(--ink)]/55 mb-0.5 truncate uppercase tracking-wider">
                                    {db.owner}
                                  </p>
                                  <h3 className="text-[16px] font-bold leading-[1.2] tracking-tight text-[var(--ink)] line-clamp-1 break-all mb-2">
                                    {db.name}
                                  </h3>

                                  {/* Encoding + engine pills (white chips with hairline) */}
                                  <div className="flex flex-wrap gap-1.5">
                                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white border border-black/5 text-[var(--ink)]/75">
                                      {db.encoding || 'UTF8'}
                                    </span>
                                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white border border-black/5 text-[var(--ink)]/75">
                                      PostgreSQL
                                    </span>
                                  </div>
                                </div>

                                {/* Footer — either size + Download CTA, or full-width progress UI while dumping. */}
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
                                            className="h-full rounded-full transition-[width] duration-150 ease-out"
                                            style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #5b4dff, #4133ff)' }}
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
                                        className="inline-flex items-center gap-2 rounded-full bg-[var(--accent-pink)] text-white px-5 py-3 text-sm font-bold hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
                                      >
                                        <Download className="h-4 w-4" />
                                        Download
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
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
