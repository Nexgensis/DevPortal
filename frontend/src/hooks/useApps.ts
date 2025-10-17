import { useState, useEffect } from 'react';
import { App } from '../types/app';
import { appApi } from '../lib/api';
import { toast } from 'sonner';

export function useApps() {
  const [apps, setApps] = useState<App[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadApps = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const appList = await appApi.list();
      setApps(appList);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load apps';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadApps();
  }, []);

  const addApp = async (app: Omit<App, 'id' | 'status' | 'startedAt'>): Promise<App> => {
    try {
      const newApp = await appApi.create(app);
      setApps(prev => [...prev, newApp]);
      toast.success('App added successfully');
      return newApp;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to add app';
      toast.error(errorMessage);
      throw err;
    }
  };

  const updateApp = async (id: string, updates: Partial<App>): Promise<App> => {
    try {
      const updatedApp = await appApi.update(id, updates);
      setApps(prev => prev.map(app => app.id === id ? updatedApp : app));
      toast.success('App updated successfully');
      return updatedApp;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update app';
      toast.error(errorMessage);
      throw err;
    }
  };

  const removeApp = async (id: string): Promise<void> => {
    try {
      await appApi.delete(id);
      setApps(prev => prev.filter(app => app.id !== id));
      toast.success('App deleted successfully');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete app';
      toast.error(errorMessage);
      throw err;
    }
  };

  const startApp = async (id: string, timeoutMinutes: number = 60) => {
    try {
      const result = await appApi.start(id, timeoutMinutes);
      setApps(prev => prev.map(app => 
        app.id === id 
          ? { ...app, status: 'running', startedAt: Date.now() }
          : app
      ));
      toast.success(result.message);
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to start app';
      toast.error(errorMessage);
      throw err;
    }
  };

  const stopApp = async (id: string) => {
    try {
      const result = await appApi.stop(id);
      setApps(prev => prev.map(app => 
        app.id === id 
          ? { ...app, status: 'stopped', startedAt: undefined }
          : app
      ));
      toast.success(result.message);
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to stop app';
      toast.error(errorMessage);
      throw err;
    }
  };

  const getAppsByProject = (projectId: string) => {
    return apps.filter(app => app.projectId === projectId);
  };

  const getAppsByServer = (serverId: string) => {
    return apps.filter(app => app.serverId === serverId);
  };

  return {
    apps,
    isLoading,
    error,
    addApp,
    updateApp,
    removeApp,
    startApp,
    stopApp,
    getAppsByProject,
    getAppsByServer,
    reload: loadApps,
  };
}
