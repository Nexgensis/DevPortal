import { useState } from 'react';
import { RunningAppsResponse } from '../types/runningapps';
import { toast } from 'sonner';

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL)
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

export const useRunningApps = () => {
  const [loading, setLoading] = useState(false);

  const authHeaders = () => {
    let token: string | null = null;
    const auth = localStorage.getItem('devops-dashboard-auth');
    if (auth) {
      try { token = JSON.parse(auth).token; } catch { /* ignore */ }
    }
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  };

  const list = async (serverId: string): Promise<RunningAppsResponse> => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/servers/${serverId}/running-apps`, { headers: authHeaders() });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `Failed to load running apps: ${res.statusText}`);
      }
      return await res.json();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load running apps');
      return { projects: [], pinned: [], agentMissing: false };
    } finally {
      setLoading(false);
    }
  };

  // setPinned toggles a root-group pin on a server. Admin-only on the server;
  // the UI only exposes the button to admins.
  const setPinned = async (serverId: string, groupName: string, pinned: boolean): Promise<boolean> => {
    try {
      const res = await fetch(
        `${API_BASE}/servers/${serverId}/running-apps/${encodeURIComponent(groupName)}/pin`,
        { method: pinned ? 'PUT' : 'DELETE', headers: authHeaders() },
      );
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `Failed to ${pinned ? 'pin' : 'unpin'} project`);
      }
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update pin');
      return false;
    }
  };

  return { loading, list, setPinned };
};
