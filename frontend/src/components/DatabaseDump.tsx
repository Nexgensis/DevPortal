import React, { useState, useEffect } from 'react';
import {
    Database,
    Server as ServerIcon,
    Container,
    Download,
    Loader2,
    RefreshCw,
    Search,
    CheckCircle2,
    AlertCircle
} from 'lucide-react';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from './ui/select';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { postgresApi } from '../lib/api';
import { Server, PostgresContainer, PostgresDatabase } from '../types/app';
import { toast } from 'sonner';

interface DatabaseDumpProps {
    servers: Server[];
}

export function DatabaseDump({ servers }: DatabaseDumpProps) {
    const [selectedServerId, setSelectedServerId] = useState<string>(servers[0]?.id || '');
    const [containers, setContainers] = useState<PostgresContainer[]>([]);
    const [selectedContainerId, setSelectedContainerId] = useState<string>('');
    const [databases, setDatabases] = useState<PostgresDatabase[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isDumping, setIsDumping] = useState<string | null>(null);
    const [containerSearch, setContainerSearch] = useState('');

    // Auto-select first server if not set
    useEffect(() => {
        if (!selectedServerId && servers.length > 0) {
            setSelectedServerId(servers[0].id);
        }
    }, [servers]);

    // Load containers when server changes
    useEffect(() => {
        if (selectedServerId) {
            loadContainers();
        }
    }, [selectedServerId]);

    // Load databases when container changes
    useEffect(() => {
        if (selectedContainerId) {
            loadDatabases();
        } else {
            setDatabases([]);
        }
    }, [selectedContainerId]);

    const loadContainers = async () => {
        try {
            setIsLoading(true);
            const data = await postgresApi.listContainers(selectedServerId);
            setContainers(data.containers);
            if (data.containers.length > 0) {
                setSelectedContainerId(data.containers[0].id);
            } else {
                setSelectedContainerId('');
            }
        } catch (error) {
            toast.error('Failed to load PostgreSQL containers');
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    const loadDatabases = async () => {
        try {
            setIsLoading(true);
            const data = await postgresApi.listDatabases(selectedServerId, selectedContainerId);
            setDatabases(data.databases);
        } catch (error) {
            toast.error('Failed to load databases');
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleDownload = async (dbName: string) => {
        try {
            setIsDumping(dbName);
            const blob = await postgresApi.createDump({
                server_id: selectedServerId,
                container_id: selectedContainerId,
                database: dbName,
                data_only: false, // Default to full dump in this view
                schema_only: false,
            });

            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${dbName}_${new Date().toISOString().split('T')[0]}.sql`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            toast.success(`Dump of "${dbName}" downloaded successfully`);
        } catch (error) {
            toast.error(`Failed to dump database "${dbName}"`);
            console.error(error);
        } finally {
            setIsDumping(null);
        }
    };

    const selectedServer = servers.find(s => s.id === selectedServerId);
    const filteredContainers = containers.filter(c =>
        c.name.toLowerCase().includes(containerSearch.toLowerCase())
    );

    return (
        <div className="space-y-6">
            {/* Main Header with App Icon */}
            <div className="flex items-center gap-3 mb-8">
                <div className="h-10 w-10 bg-white border-2 border-black rounded-lg flex items-center justify-center overflow-hidden shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                    <img
                        src="https://raw.githubusercontent.com/docker/labs/master/beginner/images/whale.png"
                        alt="Docker"
                        className="h-6 w-6 object-contain"
                    />
                </div>
                <h1 className="text-3xl font-black tracking-tight">PostgreSQL Containers</h1>
            </div>

            {/* Server Selection Toolbar */}
            <div className="bg-secondary/20 p-4 rounded-xl border-2 border-black flex items-center justify-between mb-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-white border-2 border-black rounded-lg text-sm font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                        <ServerIcon className="h-4 w-4" />
                        Server:
                        <Select value={selectedServerId} onValueChange={setSelectedServerId}>
                            <SelectTrigger className="border-none p-0 h-auto focus:ring-0 font-black text-accent ml-1">
                                <SelectValue placeholder="Select server" />
                            </SelectTrigger>
                            <SelectContent className="border-2 border-black">
                                {servers.map(s => (
                                    <SelectItem key={s.id} value={s.id} className="font-bold">{s.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <Button
                    variant="outline"
                    onClick={loadContainers}
                    disabled={isLoading}
                    className="border-2 border-black rounded-lg hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] bg-white"
                >
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                    Sync Status
                </Button>
            </div>

            {/* Split Content Area */}
            <div className="bg-white border-2 border-black rounded-2xl shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden flex flex-col md:flex-row min-h-[600px]">

                {/* Sidebar - Container List */}
                <div className="w-full md:w-[320px] border-r-2 border-black flex flex-col bg-secondary/5">
                    <div className="p-4 border-b-2 border-black bg-white">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <input
                                type="text"
                                placeholder="Filter containers..."
                                value={containerSearch}
                                onChange={(e) => setContainerSearch(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 bg-secondary/10 border-2 border-black rounded-lg text-sm font-bold focus:outline-none focus:ring-2 focus:ring-accent"
                            />
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto divide-y-2 divide-black/5">
                        {filteredContainers.map(container => (
                            <button
                                key={container.id}
                                onClick={() => setSelectedContainerId(container.id)}
                                className={`w-full text-left p-5 transition-colors group relative ${selectedContainerId === container.id
                                        ? 'bg-accent/10'
                                        : 'hover:bg-accent/5 bg-white'
                                    }`}
                            >
                                {selectedContainerId === container.id && (
                                    <div className="absolute left-0 top-0 w-1.5 h-full bg-accent" />
                                )}
                                <div className="flex items-center gap-3 mb-1">
                                    <div className={`h-8 w-8 rounded border-2 border-black flex items-center justify-center bg-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] group-hover:bg-accent transition-colors ${selectedContainerId === container.id ? 'bg-accent border-black' : ''}`}>
                                        <Container className={`h-4 w-4 ${selectedContainerId === container.id ? 'text-white' : 'text-black'}`} />
                                    </div>
                                    <span className={`font-black text-sm truncate ${selectedContainerId === container.id ? 'text-accent' : 'text-black'}`}>
                                        {container.name}
                                    </span>
                                </div>
                                <div className="pl-11 text-[10px] font-bold text-muted-foreground uppercase opacity-70">
                                    {container.status || 'Status Unknown'}
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Main Content - Databases Area */}
                <div className="flex-1 p-8 bg-white overflow-y-auto">
                    {selectedContainerId ? (
                        <>
                            <div className="mb-10 text-left">
                                <h2 className="text-3xl font-black mb-1">{containers.find(c => c.id === selectedContainerId)?.name}</h2>
                                <p className="text-muted-foreground font-medium">PostgreSQL databases inside this container</p>
                            </div>

                            {isLoading ? (
                                <div className="flex flex-col items-center justify-center py-20 opacity-50">
                                    <Loader2 className="h-12 w-12 animate-spin text-accent mb-4" />
                                    <p className="font-bold uppercase tracking-widest text-xs">Fetching Databases...</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-6">
                                    {databases.map(db => (
                                        <div
                                            key={db.name}
                                            className="bg-white border-2 border-black rounded-xl p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] transition-all flex flex-col"
                                        >
                                            <div className="flex items-start justify-between mb-6">
                                                <div className="flex items-center gap-3">
                                                    <div className="h-12 w-12 bg-accent/10 border-2 border-black rounded-lg flex items-center justify-center text-accent shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                                                        <Database className="h-6 w-6" />
                                                    </div>
                                                    <div className="text-left">
                                                        <h4 className="font-black text-xl truncate max-w-[140px] leading-none mb-2">{db.name}</h4>
                                                        <Badge variant="outline" className="text-[10px] border-black h-5 uppercase font-black bg-white">Container</Badge>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="space-y-3 mb-8 flex-1">
                                                <div className="flex justify-between items-center text-sm">
                                                    <span className="text-muted-foreground font-bold">Owner:</span>
                                                    <span className="font-black bg-secondary/10 px-2 py-0.5 rounded border border-black/5">{db.owner}</span>
                                                </div>
                                                <div className="flex justify-between items-center text-sm">
                                                    <span className="text-muted-foreground font-bold">Encoding:</span>
                                                    <span className="font-black bg-secondary/10 px-2 py-0.5 rounded border border-black/5">{db.encoding}</span>
                                                </div>
                                                <div className="flex justify-between items-center text-sm">
                                                    <span className="text-muted-foreground font-bold">Size:</span>
                                                    <span className="font-black text-accent bg-accent/5 px-2 py-0.5 rounded border border-accent/20">{db.size || '0 MB'}</span>
                                                </div>
                                            </div>

                                            <Button
                                                onClick={() => handleDownload(db.name)}
                                                disabled={!!isDumping}
                                                className="w-full bg-white text-black border-2 border-black hover:bg-black hover:text-white font-black rounded-lg shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:shadow-none transition-all gap-2 h-11"
                                            >
                                                {isDumping === db.name ? (
                                                    <Loader2 className="h-5 w-5 animate-spin" />
                                                ) : (
                                                    <Download className="h-5 w-5" />
                                                )}
                                                {isDumping === db.name ? 'Preparing...' : 'Download Dump'}
                                            </Button>
                                        </div>
                                    ))}
                                    {databases.length === 0 && (
                                        <div className="col-span-full py-20 text-center border-4 border-dashed border-black/10 rounded-2xl bg-secondary/5">
                                            <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-20" />
                                            <h3 className="text-xl font-black mb-1">No Databases Found</h3>
                                            <p className="text-muted-foreground font-bold">This container appears to be empty.</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-center p-12">
                            <div className="h-24 w-24 bg-secondary/10 border-2 border-dashed border-black rounded-2xl flex items-center justify-center mb-6 opacity-30">
                                <Database className="h-10 w-10 text-muted-foreground" />
                            </div>
                            <h3 className="text-2xl font-black mb-2 uppercase tracking-tighter">Container Selection</h3>
                            <p className="max-w-xs text-muted-foreground font-bold">
                                Select a PostgreSQL container from the left sidebar to view accessible databases and administrative options.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
