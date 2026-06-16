import { useCallback, useEffect, useRef, useState } from 'react';

// Fleet-wide live resource insights — mirrors the backend FleetResources shape.
export interface ContainerResource {
  name: string;
  server: string;
  cpuPct: number;
  memBytes: number;
  memLimit: number;
}

export interface ServerLoad {
  server: string;
  online: boolean;
  containers: number;
  cpuPct: number;
  memBytes: number;
}

export interface FleetResources {
  computing: boolean;      // first gather still running — keep polling
  generatedAt: string;
  containers: number;
  totalCpu: number;
  totalMem: number;
  topCpu: ContainerResource[];
  topMem: ContainerResource[];
  servers: ServerLoad[];
}

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL)
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

function authHeaders(): Record<string, string> {
  let token: string | null = null;
  const auth = localStorage.getItem('devops-dashboard-auth');
  if (auth) {
    try { token = JSON.parse(auth).token; } catch { /* ignore */ }
  }
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// useFleetResources fetches /fleet/resources and, because the backend gathers
// stats in the background, polls quickly while `computing` is true, then settles
// into a slow refresh that matches the server-side cache (~60s).
export function useFleetResources() {
  const [data, setData] = useState<FleetResources | null>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const fetchOnce = useCallback(async (): Promise<boolean | undefined> => {
    try {
      const res = await fetch(`${API_BASE}/fleet/resources`, { headers: authHeaders() });
      if (!res.ok) return undefined;
      const j = (await res.json()) as FleetResources;
      setData(j);
      setLoading(false);
      return j.computing;
    } catch {
      return undefined;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const computing = await fetchOnce();
      if (cancelled) return;
      // Poll fast while the first gather runs; once we have data, refresh on the
      // cache cadence so the numbers stay live without hammering the API.
      const delay = computing === undefined ? 8000 : computing ? 4000 : 60000;
      timer.current = setTimeout(tick, delay);
    };
    tick();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [fetchOnce]);

  return { data, loading, reload: fetchOnce };
}
