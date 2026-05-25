import { useState, useEffect } from 'react';
import { usePostgres } from '../hooks/usePostgres';
import { useServers } from '../hooks/useServers';
import { PostgresContainer, PostgresDatabase, PostgresCredential } from '../types/postgres';
import { Database, Download, Server, Container, Clock, ChevronRight, KeyRound, Eye, EyeOff } from 'lucide-react';
import { ScrollArea } from './ui/scroll-area';
import { GlassCard } from './ui/glass-card';
import { AccentButton } from './ui/accent-button';
import { GlassSkeleton } from './ui/glass-skeleton';
import { StatusBadge } from './ui/status-badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';

export const PostgresManager = () => {
  const { servers } = useServers();
  const { getContainers, getDatabases, createDump, getCredentials, saveCredential, deleteCredential, loading } = usePostgres();

  const [selectedServer, setSelectedServer] = useState<string>('');
  const [containers, setContainers] = useState<PostgresContainer[]>([]);
  const [selectedContainer, setSelectedContainer] = useState<string>('');
  const [databases, setDatabases] = useState<PostgresDatabase[]>([]);
  const [loadingContainers, setLoadingContainers] = useState(false);
  const [loadingDatabases, setLoadingDatabases] = useState(false);
  const [dumpingDatabase, setDumpingDatabase] = useState<string | null>(null);

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

  const handleDump = async (databaseName: string) => {
    setDumpingDatabase(databaseName);
    if (!selectedServer || !selectedContainer || !databaseName) {
      return;
    }

    try {
      const blob = await createDump({
        server_id: selectedServer,
        container_id: selectedContainer,
        database: databaseName,
        container_name: selectedContainerData?.name,
      });

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

  if (servers.length === 0) {
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

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {servers.map((server) => (
              <button
                key={server.id}
                onClick={() => setSelectedServer(server.id)}
                className="bento-card group flex items-center gap-3 p-4 text-left transition-colors hover:bg-[var(--card-warm)] focus-ring-cyan"
              >
                <div className="h-10 w-10 rounded-xl bg-[var(--accent-pink-soft)] flex items-center justify-center flex-shrink-0">
                  <Server className="h-5 w-5 text-[var(--ink)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-[var(--ink)] truncate">{server.name}</div>
                  <div className="text-xs text-[var(--ink-muted)] truncate">{server.address}</div>
                  <div className="mt-1.5">
                    <StatusBadge status={serverStatus(server)} />
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-[var(--ink-muted)] transition-transform group-hover:translate-x-0.5" />
              </button>
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
                          className={`w-full text-left p-3 rounded-xl mb-1 transition-colors relative focus-ring-cyan ${
                            isSelected ? 'bg-[var(--card)] border border-[var(--border)]' : 'hover:bg-black/[0.03]'
                          }`}
                        >
                          {isSelected && (
                            <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-[var(--accent-pink)]" />
                          )}
                          <div className="flex items-start gap-3 pl-2">
                            <Container
                              className={`h-5 w-5 mt-0.5 flex-shrink-0 ${isSelected ? 'text-[var(--ink)]' : 'text-[var(--ink-muted)]'}`}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm truncate text-[var(--ink)]">{container.name}</div>
                              <div className="text-xs text-[var(--ink-muted)] flex items-center gap-1 mt-1">
                                <Clock className="h-3 w-3" />
                                {container.status}
                              </div>
                            </div>
                          </div>
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
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                          {databases.map((db) => (
                            <div key={db.name} className="bento-card p-5">
                              <div className="flex items-start justify-between mb-4">
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="h-10 w-10 rounded-xl bg-[var(--accent-pink-soft)] flex items-center justify-center flex-shrink-0">
                                    <Database className="h-5 w-5 text-[var(--ink)]" />
                                  </div>
                                  <div className="font-medium truncate text-[var(--ink)]">{db.name}</div>
                                </div>
                                <StatusBadge status="online" label="Active" />
                              </div>

                              <div className="space-y-2 mb-4 text-sm">
                                <div className="flex justify-between">
                                  <span className="text-[var(--ink-muted)]">Owner:</span>
                                  <span className="font-medium text-[var(--ink)]">{db.owner}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-[var(--ink-muted)]">Encoding:</span>
                                  <span className="font-medium text-[var(--ink)]">{db.encoding}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-[var(--ink-muted)]">Size:</span>
                                  <span className="font-medium text-[var(--ink)]">{db.size || 'N/A'}</span>
                                </div>
                              </div>

                              <AccentButton
                                variant="ghost"
                                onClick={() => handleDump(db.name)}
                                disabled={loading || dumpingDatabase === db.name}
                                loading={dumpingDatabase === db.name}
                                className="w-full"
                              >
                                {dumpingDatabase !== db.name && <Download className="h-4 w-4" />}
                                Download Dump
                              </AccentButton>
                            </div>
                          ))}
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
