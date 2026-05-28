import { useState } from 'react';
import { ScanReport, ScanSourceInput, ParsedReportResponse } from '../types/scan';
import { toast } from 'sonner';

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL)
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

export const useScanReports = () => {
  const [loading, setLoading] = useState(false);

  const authHeaders = () => {
    let token: string | null = null;
    const auth = localStorage.getItem('devops-dashboard-auth');
    if (auth) {
      try { token = JSON.parse(auth).token; } catch { /* ignore */ }
    }
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  };

  const list = async (): Promise<ScanReport[]> => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/scan-reports`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to load scan reports: ${res.statusText}`);
      const data = await res.json();
      return data.reports || [];
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load scan reports');
      return [];
    } finally {
      setLoading(false);
    }
  };

  const get = async (id: string): Promise<ScanReport | null> => {
    try {
      const res = await fetch(`${API_BASE}/scan-reports/${id}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to load report: ${res.statusText}`);
      return await res.json();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load report');
      return null;
    }
  };

  // getParsed returns the structured DTO (severity counts + Trivy/ZAP/Sonar
  // payload). Used by the dashboard tab to render badges + tabbed panels
  // without each component having to know each scanner's raw format.
  const getParsed = async (id: string): Promise<ParsedReportResponse | null> => {
    try {
      const res = await fetch(`${API_BASE}/scan-reports/${id}/parsed`, { headers: authHeaders() });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `Failed to load parsed report: ${res.statusText}`);
      }
      return await res.json();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load parsed report');
      return null;
    }
  };

  const addSource = async (input: ScanSourceInput): Promise<boolean> => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/scan-reports`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify(input),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `Failed to add source: ${res.statusText}`);
      }
      toast.success('Scan source added');
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add source');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const updateSource = async (id: string, input: ScanSourceInput): Promise<boolean> => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/scan-reports/${id}`, {
        method: 'PUT', headers: authHeaders(), body: JSON.stringify(input),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `Failed to update source: ${res.statusText}`);
      }
      toast.success('Scan source updated');
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update source');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const refresh = async (id: string): Promise<boolean> => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/scan-reports/${id}/refresh`, { method: 'POST', headers: authHeaders() });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `Refresh failed: ${res.statusText}`);
      }
      toast.success('Report refreshed');
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Refresh failed');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const deleteSource = async (id: string): Promise<boolean> => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/scan-reports/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to delete: ${res.statusText}`);
      toast.success('Scan source removed');
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
      return false;
    } finally {
      setLoading(false);
    }
  };

  return { loading, list, get, getParsed, addSource, updateSource, refresh, deleteSource };
};
