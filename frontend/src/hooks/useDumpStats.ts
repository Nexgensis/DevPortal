import { useEffect, useState } from 'react';

// Mirrors the dumpStatsResponse struct in backend/controllers/dump_stats.go.
// Keep the field names in sync if either side changes.
export interface DumpStats {
  mostDumpedDatabases: { database: string; count: number }[];
  topUsers: { username: string; count: number }[];
  totalThisMonth: { count: number; sizeBytes: number };
  trend: { date: string; count: number }[];
}

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL)
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

const authHeaders = (): HeadersInit => {
  const auth = localStorage.getItem('devops-dashboard-auth');
  let token: string | null = null;
  if (auth) {
    try { token = JSON.parse(auth).token; } catch { /* ignore */ }
  }
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
};

// useDumpStats fetches the aggregate dump metrics once on mount. Refetch via
// the returned `reload` (e.g. after a fresh dump completes). Failures are
// silently coerced to nulls so the strip can render an empty state without
// blocking the page.
export function useDumpStats() {
  const [data, setData] = useState<DumpStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/postgres/dump-stats`, { headers: authHeaders() });
      if (!res.ok) {
        setData(null);
        return;
      }
      setData(await res.json());
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return { data, loading, reload: load };
}
