import { useState, useEffect } from 'react';
import { Server } from '../types/app';
import { serverApi } from '../lib/api';
import { toast } from 'sonner';

export function useServers() {
  const [servers, setServers] = useState<Server[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadServers = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const serverList = await serverApi.list();
      setServers(serverList);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load servers';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadServers();
  }, []);

  const addServer = async (server: Omit<Server, 'id' | 'status' | 'runningAppsCount' | 'lastChecked'>): Promise<Server> => {
    try {
      const newServer = await serverApi.create(server);
      setServers(prev => [...prev, newServer]);
      toast.success('Server added successfully');
      return newServer;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to add server';
      toast.error(errorMessage);
      throw err;
    }
  };

  const updateServer = async (id: string, updates: Partial<Server>): Promise<Server> => {
    try {
      const updatedServer = await serverApi.update(id, updates);
      setServers(prev => prev.map(server => server.id === id ? updatedServer : server));
      toast.success('Server updated successfully');
      return updatedServer;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update server';
      toast.error(errorMessage);
      throw err;
    }
  };

  const removeServer = async (id: string): Promise<void> => {
    try {
      await serverApi.delete(id);
      setServers(prev => prev.filter(server => server.id !== id));
      toast.success('Server deleted successfully');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete server';
      toast.error(errorMessage);
      throw err;
    }
  };

  const testServerConnection = async (id: string) => {
    try {
      const result = await serverApi.testConnection(id);
      setServers(prev => prev.map(server => 
        server.id === id 
          ? { 
              ...server, 
              status: result.status as 'online' | 'offline' | 'checking',
              runningAppsCount: result.runningAppsCount,
              lastChecked: result.lastChecked
            }
          : server
      ));
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to test server connection';
      toast.error(errorMessage);
      throw err;
    }
  };

  const refreshAllServers = async () => {
    try {
      const result = await serverApi.refreshAll();
      setServers(result.servers);
      toast.success(result.message);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to refresh servers';
      toast.error(errorMessage);
      throw err;
    }
  };

  return {
    servers,
    isLoading,
    error,
    addServer,
    updateServer,
    removeServer,
    testServerConnection,
    refreshAllServers,
    reload: loadServers,
  };
}
