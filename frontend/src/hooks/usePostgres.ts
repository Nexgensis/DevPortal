import { useState } from 'react';
import { PostgresContainer, PostgresDatabase, PostgresDumpRequest, PostgresCredential, PostgresCredentialInput } from '../types/postgres';
import { toast } from 'sonner';

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL)
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

export const usePostgres = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getAuthToken = () => {
    const auth = localStorage.getItem('devops-dashboard-auth');
    if (!auth) return null;
    try {
      const parsed = JSON.parse(auth);
      return parsed.token;
    } catch {
      return null;
    }
  };

  const getContainers = async (serverId: string): Promise<PostgresContainer[]> => {
    setLoading(true);
    setError(null);
    try {
      const token = getAuthToken();
      const response = await fetch(`${API_BASE}/servers/${serverId}/postgres/containers`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch containers: ${response.statusText}`);
      }

      const data = await response.json();
      return data.containers || [];
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load containers';
      setError(message);
      toast.error(message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const getDatabases = async (serverId: string, containerId: string, containerName?: string): Promise<PostgresDatabase[]> => {
    setLoading(true);
    setError(null);
    try {
      const token = getAuthToken();
      // Pass the container name so the backend can resolve stored credentials.
      const query = containerName ? `?container_name=${encodeURIComponent(containerName)}` : '';
      const response = await fetch(
        `${API_BASE}/servers/${serverId}/postgres/containers/${containerId}/databases${query}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch databases: ${response.statusText}`);
      }

      const data = await response.json();
      return data.databases || [];
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load databases';
      setError(message);
      toast.error(message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  // createDump streams the pg_dump response chunk-by-chunk via the body reader
  // instead of buffering with response.blob(). `onProgress` is called with the
  // running byte count plus Content-Length when known — chunked transfers from
  // pg_dump usually don't set Content-Length, so callers should treat a null
  // `total` as "indeterminate, show bytes received".
  const createDump = async (
    request: PostgresDumpRequest,
    opts?: { onProgress?: (received: number, total: number | null) => void },
  ): Promise<Blob> => {
    setLoading(true);
    setError(null);
    try {
      const token = getAuthToken();
      const response = await fetch(`${API_BASE}/postgres/dump`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to create dump: ${response.statusText}`);
      }

      const contentLengthHeader = response.headers.get('Content-Length');
      const total = contentLengthHeader ? parseInt(contentLengthHeader, 10) : null;
      const contentType = response.headers.get('Content-Type') || 'application/octet-stream';

      // No body reader? Fall back to blob() so we don't break older browsers.
      if (!response.body) {
        const blob = await response.blob();
        opts?.onProgress?.(blob.size, blob.size);
        return blob;
      }

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      // Prime the bar at 0 so the UI flips into "downloading" state immediately.
      opts?.onProgress?.(0, total);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.byteLength;
          opts?.onProgress?.(received, total);
        }
      }
      return new Blob(chunks as BlobPart[], { type: contentType });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create database dump';
      setError(message);
      toast.error(message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const testConnection = async (serverId: string, containerId: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      const token = getAuthToken();
      const response = await fetch(
        `${API_BASE}/servers/${serverId}/postgres/containers/${containerId}/test`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Connection test failed: ${response.statusText}`);
      }

      const data = await response.json();
      return data.success || false;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection test failed';
      setError(message);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const getCredentials = async (serverId: string): Promise<PostgresCredential[]> => {
    try {
      const token = getAuthToken();
      const response = await fetch(`${API_BASE}/servers/${serverId}/postgres/credentials`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) throw new Error(`Failed to fetch credentials: ${response.statusText}`);
      const data = await response.json();
      return data.credentials || [];
    } catch (err) {
      // Non-fatal: the UI can still operate with auto-detection.
      console.error('Failed to load credentials:', err);
      return [];
    }
  };

  const saveCredential = async (serverId: string, input: PostgresCredentialInput): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      const token = getAuthToken();
      const response = await fetch(`${API_BASE}/servers/${serverId}/postgres/credentials`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to save credentials: ${response.statusText}`);
      }
      toast.success('Database credentials saved');
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save credentials';
      setError(message);
      toast.error(message);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const deleteCredential = async (serverId: string, containerName: string): Promise<boolean> => {
    setLoading(true);
    try {
      const token = getAuthToken();
      const response = await fetch(
        `${API_BASE}/servers/${serverId}/postgres/credentials/${encodeURIComponent(containerName)}`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );
      if (!response.ok) throw new Error(`Failed to delete credentials: ${response.statusText}`);
      toast.success('Database credentials removed');
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete credentials';
      toast.error(message);
      return false;
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    error,
    getContainers,
    getDatabases,
    createDump,
    testConnection,
    getCredentials,
    saveCredential,
    deleteCredential,
  };
};
