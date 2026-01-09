import { useState } from 'react';
import { PostgresContainer, PostgresDatabase, PostgresDumpRequest } from '../types/postgres';
import { toast } from 'sonner';

const API_BASE = 'http://localhost:10000/api';

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

  const getDatabases = async (serverId: string, containerId: string): Promise<PostgresDatabase[]> => {
    setLoading(true);
    setError(null);
    try {
      const token = getAuthToken();
      const response = await fetch(
        `${API_BASE}/servers/${serverId}/postgres/containers/${containerId}/databases`,
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

  const createDump = async (request: PostgresDumpRequest): Promise<Blob> => {
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

      const blob = await response.blob();
      return blob;
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

  return {
    loading,
    error,
    getContainers,
    getDatabases,
    createDump,
    testConnection,
  };
};
