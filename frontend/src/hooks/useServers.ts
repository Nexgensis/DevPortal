import { useState, useEffect } from 'react';
import { Server } from '../types/app';
import { encrypt } from '../lib/encryption';

const STORAGE_KEY = 'devops-dashboard-servers';

export function useServers() {
  const [servers, setServers] = useState<Server[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setServers(JSON.parse(stored));
      } catch (error) {
        console.error('Failed to parse servers from localStorage:', error);
      }
    }
  }, []);

  const saveServers = (newServers: Server[]) => {
    setServers(newServers);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newServers));
  };

  const addServer = (server: Omit<Server, 'id' | 'status' | 'runningAppsCount'>) => {
    // Encrypt the SSH private key before storing
    const encryptedKey = encrypt(server.sshPrivateKey);
    
    const newServer: Server = {
      ...server,
      sshPrivateKey: encryptedKey,
      id: Date.now().toString(),
      status: 'offline',
      runningAppsCount: 0,
    };
    saveServers([...servers, newServer]);
  };

  const updateServer = (id: string, updates: Partial<Server>) => {
    // If updating SSH private key, encrypt it
    if (updates.sshPrivateKey) {
      updates.sshPrivateKey = encrypt(updates.sshPrivateKey);
    }
    
    saveServers(servers.map(server => server.id === id ? { ...server, ...updates } : server));
  };

  const removeServer = (id: string) => {
    saveServers(servers.filter(server => server.id !== id));
  };

  return {
    servers,
    addServer,
    updateServer,
    removeServer,
  };
}
