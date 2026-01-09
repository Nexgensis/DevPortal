import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from './ui/dialog';
import { Button } from './ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from './ui/select';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';
import { postgresApi } from '../lib/api';
import { PostgresContainer, PostgresDatabase, Server } from '../types/app';
import { toast } from 'sonner';
import { Database, Download, Loader2, RefreshCw } from 'lucide-react';

interface PostgresDumpDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    server: Server | null;
}

export function PostgresDumpDialog({ open, onOpenChange, server }: PostgresDumpDialogProps) {
    const [containers, setContainers] = useState<PostgresContainer[]>([]);
    const [databases, setDatabases] = useState<PostgresDatabase[]>([]);
    const [selectedContainer, setSelectedContainer] = useState<string>('');
    const [selectedDb, setSelectedDb] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);
    const [isDumping, setIsDumping] = useState(false);
    const [options, setOptions] = useState({
        dataOnly: false,
        schemaOnly: false,
    });

    useEffect(() => {
        if (open && server) {
            loadContainers();
        } else {
            resetState();
        }
    }, [open, server]);

    const resetState = () => {
        setContainers([]);
        setDatabases([]);
        setSelectedContainer('');
        setSelectedDb('');
        setIsLoading(false);
        setIsDumping(false);
        setOptions({ dataOnly: false, schemaOnly: false });
    };

    const loadContainers = async () => {
        if (!server) return;
        try {
            setIsLoading(true);
            const data = await postgresApi.listContainers(server.id);
            setContainers(data.containers);
            if (data.containers.length === 1) {
                setSelectedContainer(data.containers[0].id);
                loadDatabases(data.containers[0].id);
            }
        } catch (error) {
            toast.error('Failed to load PostgreSQL containers');
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    const loadDatabases = async (containerId: string) => {
        if (!server) return;
        try {
            setIsLoading(true);
            const data = await postgresApi.listDatabases(server.id, containerId);
            setDatabases(data.databases);
        } catch (error) {
            toast.error('Failed to load databases');
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleContainerChange = (id: string) => {
        setSelectedContainer(id);
        setSelectedDb('');
        loadDatabases(id);
    };

    const handleDownload = async () => {
        if (!server || !selectedContainer || !selectedDb) return;

        try {
            setIsDumping(true);
            const blob = await postgresApi.createDump({
                server_id: server.id,
                container_id: selectedContainer,
                database: selectedDb,
                data_only: options.dataOnly,
                schema_only: options.schemaOnly,
            });

            // Create download link
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${selectedDb}_${new Date().toISOString().split('T')[0]}.sql`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            toast.success('Database dump completed successfully');
            onOpenChange(false);
        } catch (error) {
            toast.error('Failed to create database dump');
            console.error(error);
        } finally {
            setIsDumping(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Database className="h-5 w-5" />
                        Database Dump
                    </DialogTitle>
                    <DialogDescription>
                        Create a dump of your PostgreSQL database on {server?.name}.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="container">PostgreSQL Container</Label>
                        <Select
                            value={selectedContainer}
                            onValueChange={handleContainerChange}
                            disabled={isLoading || isDumping}
                        >
                            <SelectTrigger id="container">
                                <SelectValue placeholder="Select a container" />
                            </SelectTrigger>
                            <SelectContent>
                                {containers.map((c) => (
                                    <SelectItem key={c.id} value={c.id}>
                                        {c.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="database">Database</Label>
                        <Select
                            value={selectedDb}
                            onValueChange={setSelectedDb}
                            disabled={isLoading || isDumping || !selectedContainer}
                        >
                            <SelectTrigger id="database">
                                <SelectValue placeholder="Select a database" />
                            </SelectTrigger>
                            <SelectContent>
                                {databases.map((db) => (
                                    <SelectItem key={db.name} value={db.name}>
                                        {db.name} ({db.size || 'unknown size'})
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex flex-col gap-3 pt-2">
                        <div className="flex items-center space-x-2">
                            <Checkbox
                                id="schemaOnly"
                                checked={options.schemaOnly}
                                onCheckedChange={(checked) =>
                                    setOptions({ ...options, schemaOnly: !!checked, dataOnly: checked ? false : options.dataOnly })
                                }
                                disabled={isDumping}
                            />
                            <Label htmlFor="schemaOnly">Schema only (no data)</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <Checkbox
                                id="dataOnly"
                                checked={options.dataOnly}
                                onCheckedChange={(checked) =>
                                    setOptions({ ...options, dataOnly: !!checked, schemaOnly: checked ? false : options.schemaOnly })
                                }
                                disabled={isDumping}
                            />
                            <Label htmlFor="dataOnly">Data only (no schema)</Label>
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={isDumping}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleDownload}
                        disabled={!selectedDb || isDumping}
                        className="gap-2"
                    >
                        {isDumping ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Dumping...
                            </>
                        ) : (
                            <>
                                <Download className="h-4 w-4" />
                                Download SQL
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
