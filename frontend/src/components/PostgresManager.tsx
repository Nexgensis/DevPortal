import { useState, useEffect } from 'react';
import { usePostgres } from '../hooks/usePostgres';
import { useServers } from '../hooks/useServers';
import { PostgresContainer, PostgresDatabase } from '../types/postgres';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Database, Download, Server, Container, Clock, Loader2 } from 'lucide-react';
import { ScrollArea } from './ui/scroll-area';
import { GlassCard } from './ui/glass-card';
import { AccentButton } from './ui/accent-button';
import { GlassSkeleton } from './ui/glass-skeleton';

export const PostgresManager = () => {
  const { servers } = useServers();
  const { getContainers, getDatabases, createDump, loading } = usePostgres();

  const [selectedServer, setSelectedServer] = useState<string>('');
  const [containers, setContainers] = useState<PostgresContainer[]>([]);
  const [selectedContainer, setSelectedContainer] = useState<string>('');
  const [databases, setDatabases] = useState<PostgresDatabase[]>([]);
  const [loadingContainers, setLoadingContainers] = useState(false);
  const [loadingDatabases, setLoadingDatabases] = useState(false);
  const [dumpingDatabase, setDumpingDatabase] = useState<string | null>(null);

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
      const data = await getContainers(selectedServer);
      setContainers(data);
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
    setLoadingDatabases(true);
    try {
      const data = await getDatabases(selectedServer, selectedContainer);
      setDatabases(data);
    } catch (error) {
      console.error('Failed to load databases:', error);
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

  const selectedContainerData = containers.find(c => c.id === selectedContainer);

  if (servers.length === 0) {
    return (
      <GlassCard>
        <div className="text-center py-16">
          <div className="h-24 w-24 rounded-2xl glass-card flex items-center justify-center mx-auto mb-6">
            <Server className="h-12 w-12 text-slate-500" />
          </div>
          <h3 className="mb-3 text-lg font-semibold text-slate-900">No Servers Configured</h3>
          <p className="text-slate-600 max-w-md mx-auto">
            Add a server from the Infrastructure page to manage PostgreSQL containers and databases.
          </p>
        </div>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-6">
      {/* Server Selection Card */}
      {!selectedServer && (
        <GlassCard>
          <div className="flex items-center gap-4 mb-6">
            <div className="h-12 w-12 rounded-2xl bg-[var(--accent-cyan)] flex items-center justify-center shadow-[0_4px_18px_rgba(0,229,255,0.3)]">
              <Database className="h-6 w-6 text-[#0A0B14]" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-slate-900">PostgreSQL Containers</h2>
              <p className="text-slate-600 text-sm">Select a server to view PostgreSQL containers</p>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Select Server</label>
            <Select value={selectedServer} onValueChange={setSelectedServer}>
              <SelectTrigger className="h-12">
                <SelectValue placeholder="Choose a server" />
              </SelectTrigger>
              <SelectContent>
                {servers.map((server) => (
                  <SelectItem key={server.id} value={server.id}>
                    <div className="flex items-center gap-2">
                      <Server className="h-4 w-4" />
                      {server.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </GlassCard>
      )}

      {/* Split Pane Layout */}
      {selectedServer && (
        <GlassCard className="p-0 overflow-hidden">
          {/* Header */}
          <div className="p-6 border-b border-black/6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-2xl bg-[var(--accent-cyan)] flex items-center justify-center shadow-[0_4px_18px_rgba(0,229,255,0.3)]">
                <Database className="h-6 w-6 text-[#0A0B14]" />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-semibold text-slate-900">PostgreSQL Containers</h2>
                <p className="text-slate-600 text-sm">
                  {servers.find(s => s.id === selectedServer)?.name || 'Server'}
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
            <div className="w-80 border-r border-black/6 bg-black/3">
              <ScrollArea className="h-full">
                <div className="p-2">
                  {loadingContainers ? (
                    <div className="p-2 space-y-2">
                      <GlassSkeleton.Row count={4} />
                    </div>
                  ) : containers.length === 0 ? (
                    <div className="text-center py-12 px-4">
                      <Container className="h-12 w-12 text-slate-400 mx-auto mb-3" />
                      <p className="text-sm text-slate-600">No containers found</p>
                    </div>
                  ) : (
                    containers.map((container) => {
                      const isSelected = selectedContainer === container.id;
                      return (
                        <button
                          key={container.id}
                          onClick={() => setSelectedContainer(container.id)}
                          className={`w-full text-left p-3 rounded-xl mb-1 transition-all relative group focus-ring-cyan ${
                            isSelected
                              ? 'bg-black/8 shadow-[var(--glass-shadow)]'
                              : 'hover:bg-black/4'
                          }`}
                        >
                          {isSelected && (
                            <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-[var(--accent-lime)]" />
                          )}
                          <div className="flex items-start gap-3 pl-2">
                            <Container className={`h-5 w-5 mt-0.5 flex-shrink-0 ${isSelected ? 'text-slate-900' : 'text-slate-500'}`} />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm truncate text-slate-900">
                                {container.name}
                              </div>
                              <div className="text-xs text-slate-500 flex items-center gap-1 mt-1">
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
                      <div className="mb-6">
                        <h3 className="mb-1 text-lg font-semibold text-slate-900">{selectedContainerData.name}</h3>
                        <p className="text-sm text-slate-600">
                          PostgreSQL databases inside this container
                        </p>
                      </div>

                      {/* Database Grid */}
                      {loadingDatabases ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                          <GlassSkeleton.Card count={3} />
                        </div>
                      ) : databases.length === 0 ? (
                        <div className="text-center py-16">
                          <Database className="h-16 w-16 text-slate-400 mx-auto mb-4" />
                          <p className="text-slate-600">No databases found in this container</p>
                        </div>
                      ) : (
                        <div
                          initial="initial"
                          animate="animate"
                          className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
                        >
                          {databases.map((db) => (
                            <div
                              key={db.name}
                              className="glass-card glass-hover p-5"
                            >
                              <div className="flex items-start justify-between mb-4">
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="h-10 w-10 rounded-xl bg-[var(--accent-lime)] flex items-center justify-center flex-shrink-0 shadow-[0_3px_12px_rgba(163,255,18,0.35)]">
                                    <Database className="h-5 w-5 text-[#0A0B14]" />
                                  </div>
                                  <div className="font-medium truncate text-slate-900">{db.name}</div>
                                </div>
                                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-[color-mix(in_srgb,var(--accent-lime)_18%,transparent)] text-emerald-300 border border-[color-mix(in_srgb,var(--accent-lime)_40%,transparent)]">
                                  Active
                                </span>
                              </div>

                              <div className="space-y-2 mb-4 text-sm">
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Owner:</span>
                                  <span className="font-medium text-slate-800">{db.owner}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Encoding:</span>
                                  <span className="font-medium text-slate-800">{db.encoding}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Size:</span>
                                  <span className="font-medium text-slate-800">{db.size || 'N/A'}</span>
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
                      <Container className="h-16 w-16 text-slate-400 mx-auto mb-4" />
                      <p className="text-slate-600">Select a container to view databases</p>
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
