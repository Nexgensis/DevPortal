import { useState, useEffect } from 'react';
import { usePostgres } from '../hooks/usePostgres';
import { useServers } from '../hooks/useServers';
import { PostgresContainer, PostgresDatabase } from '../types/postgres';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Database, Download, Server, Container, Clock, CheckCircle2, Loader2 } from 'lucide-react';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';

export const PostgresManager = () => {
  const { servers } = useServers();
  const { getContainers, getDatabases, createDump, testConnection, loading } = usePostgres();

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

      // Download the file
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
      // Error is already shown by usePostgres hook via toast
    } finally {
      setDumpingDatabase(null);
    }
  };

  const getUptime = (createdDate: string): string => {
    const created = new Date(createdDate);
    const now = new Date();
    const diffMs = now.getTime() - created.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    const diffWeeks = Math.floor(diffDays / 7);

    if (diffWeeks > 0) {
      return `Up ${diffWeeks} week${diffWeeks > 1 ? 's' : ''} (healthy)`;
    } else if (diffDays > 0) {
      return `Up ${diffDays} day${diffDays > 1 ? 's' : ''} (healthy)`;
    } else {
      return `Up ${diffHours} hour${diffHours > 1 ? 's' : ''}`;
    }
  };

  const selectedContainerData = containers.find(c => c.id === selectedContainer);

  // Show empty state if no servers configured
  if (servers.length === 0) {
    return (
      <div className="bento-card">
        <div className="text-center py-16">
          <div className="h-24 w-24 rounded-xl bg-secondary border-2 border-black/10 flex items-center justify-center mx-auto mb-6">
            <Server className="h-12 w-12 text-muted-foreground/60" />
          </div>
          <h3 className="mb-3">No Servers Configured</h3>
          <p className="text-muted-foreground max-w-md mx-auto">
            Add a server from the Infrastructure page to manage PostgreSQL containers and databases.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Server Selection Card */}
      {!selectedServer && (
        <div className="bento-card">
          <div className="flex items-center gap-4 mb-6">
            <div className="h-12 w-12 rounded-xl bg-accent border-2 border-black flex items-center justify-center">
              <Database className="h-6 w-6 text-black" />
            </div>
            <div>
              <h2>PostgreSQL Containers</h2>
              <p className="text-muted-foreground">Select a server to view PostgreSQL containers</p>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Select Server</label>
            <Select value={selectedServer} onValueChange={setSelectedServer}>
              <SelectTrigger className="border-2 border-black/10 h-12 rounded-lg">
                <SelectValue placeholder="Choose a server" />
              </SelectTrigger>
              <SelectContent className="border-2 border-black/10">
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
        </div>
      )}

      {/* Split Pane Layout */}
      {selectedServer && (
        <div className="bento-card p-0 overflow-hidden">
          {/* Header */}
          <div className="p-6 border-b-2 border-black/10">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-accent border-2 border-black flex items-center justify-center">
                <Database className="h-6 w-6 text-black" />
              </div>
              <div className="flex-1">
                <h2>PostgreSQL Containers</h2>
                <p className="text-muted-foreground">
                  {servers.find(s => s.id === selectedServer)?.name || 'Server'}
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setSelectedServer('');
                  setSelectedContainer('');
                  setContainers([]);
                  setDatabases([]);
                }}
                className="border-2 border-black rounded-lg hover:bg-accent hover:text-accent-foreground"
              >
                Change Server
              </Button>
            </div>
          </div>

          {/* Split Pane Content */}
          <div className="flex h-[600px]">
            {/* Left Sidebar - Container List */}
            <div className="w-80 border-r-2 border-black/10 bg-secondary/30">
              <ScrollArea className="h-full">
                <div className="p-2">
                  {loadingContainers ? (
                    <div className="text-center py-12 px-4">
                      <Loader2 className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3 animate-spin" />
                      <p className="text-sm text-muted-foreground">Loading containers...</p>
                    </div>
                  ) : containers.length === 0 ? (
                    <div className="text-center py-12 px-4">
                      <Container className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground">No containers found</p>
                    </div>
                  ) : (
                    containers.map((container) => (
                      <button
                        key={container.id}
                        onClick={() => setSelectedContainer(container.id)}
                        className={`w-full text-left p-4 rounded-lg mb-1 transition-all relative group border-2 ${selectedContainer === container.id
                            ? 'bg-accent/10 border-black pl-3'
                            : 'hover:bg-white/50 border-transparent pl-3 hover:border-black/10'
                          }`}
                      >
                        <div className="flex items-start gap-3">
                          <Container className={`h-5 w-5 mt-0.5 flex-shrink-0 ${selectedContainer === container.id ? 'text-black' : 'text-muted-foreground'
                            }`} />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">
                              {container.name}
                            </div>
                            <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                              <Clock className="h-3 w-3" />
                              {container.status}
                            </div>
                          </div>
                        </div>
                      </button>
                    ))
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
                        <h3 className="mb-1">{selectedContainerData.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          PostgreSQL databases inside this container
                        </p>
                      </div>

                      {/* Database Grid */}
                      {loadingDatabases ? (
                        <div className="text-center py-16">
                          <Loader2 className="h-16 w-16 text-muted-foreground/40 mx-auto mb-4 animate-spin" />
                          <p className="text-muted-foreground">Loading databases...</p>
                        </div>
                      ) : databases.length === 0 ? (
                        <div className="text-center py-16">
                          <Database className="h-16 w-16 text-muted-foreground/40 mx-auto mb-4" />
                          <p className="text-muted-foreground">No databases found in this container</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                          {databases.map((db) => (
                            <Card
                              key={db.name}
                              className="border-2 border-black/10 rounded-lg hover:shadow-md transition-shadow"
                            >
                              <CardContent className="p-5">
                                {/* Database Header */}
                                <div className="flex items-start justify-between mb-4">
                                  <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 rounded-lg bg-accent border-2 border-black flex items-center justify-center flex-shrink-0">
                                      <Database className="h-5 w-5 text-black" />
                                    </div>
                                    <div className="font-medium truncate">{db.name}</div>
                                  </div>
                                  <Badge
                                    variant="outline"
                                    className="border-black text-black rounded-md text-xs px-2.5 py-0.5"
                                  >
                                    Active
                                  </Badge>
                                </div>

                                {/* Database Metadata */}
                                <div className="space-y-2 mb-4">
                                  <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">Owner:</span>
                                    <span className="font-medium">{db.owner}</span>
                                  </div>
                                  <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">Encoding:</span>
                                    <span className="font-medium">{db.encoding}</span>
                                  </div>
                                  <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">Size:</span>
                                    <span className="font-medium">{db.size || 'N/A'}</span>
                                  </div>
                                </div>

                                {/* Download Button */}
                                <Button
                                  variant="outline"
                                  onClick={() => handleDump(db.name)}
                                  disabled={loading || dumpingDatabase === db.name}
                                  className="w-full border-2 border-black/10 rounded-lg hover:bg-accent hover:border-black hover:text-accent-foreground"
                                >
                                  {dumpingDatabase === db.name ? (
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  ) : (
                                    <Download className="h-4 w-4 mr-2" />
                                  )}
                                  Download Dump
                                </Button>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-16">
                      <Container className="h-16 w-16 text-muted-foreground/40 mx-auto mb-4" />
                      <p className="text-muted-foreground">Select a container to view databases</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};