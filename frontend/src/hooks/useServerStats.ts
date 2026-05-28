import { useEffect, useState, useMemo } from 'react';
import { Server } from '../types/app';

// ServerStats summarizes the Running Apps view at the server level — used by
// the server picker cards so each tile can show "how busy" the server is at
// a glance. All three counts derive from a single /running-apps fetch per
// server (one network round-trip).
export interface ServerStats {
  containers: number;   // total running containers (across all compose projects)
  composeFiles: number; // count of distinct compose projects (one file each, roughly)
  projects: number;     // count of unique root-groups (e.g. "ebmr", "qms" under /root/<x>/...)
}

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL)
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

const rootGroupOf = (workingDir: string | undefined): string => {
  if (!workingDir) return 'other';
  const m = workingDir.match(/^\/root\/([^/]+)/);
  if (m) return m[1];
  const seg = workingDir.split('/').filter(Boolean)[0];
  return seg || 'other';
};

// useServerStats fetches /running-apps for every server in the list (in
// parallel) and returns a map of serverId → stats. While a fetch is
// in-flight or has failed, the entry stays `undefined`. Safe to call from
// the picker — failures are swallowed silently (the card just shows "—"
// rather than spamming toasts for every flaky server).
export function useServerStats(servers: Server[]): Record<string, ServerStats | undefined> {
  const [stats, setStats] = useState<Record<string, ServerStats | undefined>>({});

  // Stabilize the dependency so we re-fetch only when the actual server set
  // changes (id+address+status), not on every re-render.
  const key = useMemo(
    () => servers.map((s) => `${s.id}:${s.status}`).join('|'),
    [servers],
  );

  useEffect(() => {
    if (servers.length === 0) {
      setStats({});
      return;
    }
    let cancelled = false;

    const authHeaders = () => {
      let token: string | null = null;
      const auth = localStorage.getItem('devops-dashboard-auth');
      if (auth) {
        try { token = JSON.parse(auth).token; } catch { /* ignore */ }
      }
      return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    };

    const fetchOne = async (s: Server): Promise<[string, ServerStats | undefined]> => {
      // Offline servers won't respond — skip the round-trip.
      if (s.status === 'offline') return [s.id, undefined];
      try {
        const res = await fetch(`${API_BASE}/servers/${s.id}/running-apps`, {
          headers: authHeaders(),
        });
        if (!res.ok) return [s.id, undefined];
        const data = await res.json();
        const projects: { containers?: unknown[]; workingDir?: string }[] = data.projects || [];
        let containers = 0;
        const roots = new Set<string>();
        for (const p of projects) {
          containers += Array.isArray(p.containers) ? p.containers.length : 0;
          roots.add(rootGroupOf(p.workingDir));
        }
        return [
          s.id,
          { containers, composeFiles: projects.length, projects: roots.size },
        ];
      } catch {
        return [s.id, undefined];
      }
    };

    Promise.all(servers.map(fetchOne)).then((entries) => {
      if (cancelled) return;
      const next: Record<string, ServerStats | undefined> = {};
      for (const [id, v] of entries) next[id] = v;
      setStats(next);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return stats;
}
