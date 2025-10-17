import { useState, useEffect } from 'react';
import { App } from '../types/app';

const STORAGE_KEY = 'devops-dashboard-apps';

export function useApps() {
  const [apps, setApps] = useState<App[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsedApps = JSON.parse(stored);
        // Migrate old apps structure if needed
        const migratedApps = parsedApps.map((app: any) => {
          // Migrate appUrl to domain if exists
          const domain = app.domain || app.appUrl || '';
          const { appUrl, ...appWithoutUrl } = app;
          
          return {
            ...appWithoutUrl,
            projectId: app.projectId || '',
            serverId: app.serverId || '',
            domain,
            autoStopTimeout: app.autoStopTimeout ?? 60,
          };
        });
        setApps(migratedApps);
      } catch (error) {
        console.error('Failed to parse apps from localStorage:', error);
      }
    }
  }, []);

  const saveApps = (newApps: App[]) => {
    setApps(newApps);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newApps));
  };

  const addApp = (app: Omit<App, 'id' | 'status'>) => {
    const newApp: App = {
      ...app,
      id: Date.now().toString(),
      status: 'stopped',
    };
    saveApps([...apps, newApp]);
  };

  const updateApp = (id: string, updates: Partial<App>) => {
    saveApps(apps.map(app => app.id === id ? { ...app, ...updates } : app));
  };

  const removeApp = (id: string) => {
    saveApps(apps.filter(app => app.id !== id));
  };

  const getAppsByProject = (projectId: string) => {
    return apps.filter(app => app.projectId === projectId);
  };

  const getAppsByServer = (serverId: string) => {
    return apps.filter(app => app.serverId === serverId);
  };

  return {
    apps,
    addApp,
    updateApp,
    removeApp,
    getAppsByProject,
    getAppsByServer,
  };
}
