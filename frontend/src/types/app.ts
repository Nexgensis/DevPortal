// User roles
export type UserRole = 'admin' | 'user';

// Server configuration
export interface Server {
  id: string;
  name: string;
  address: string; // hostname/IP
  sshUser: string;
  sshPort: number;
  sshPrivateKey: string; // Encrypted SSH private key (never displayed after saving)
  status: 'online' | 'offline' | 'checking';
  lastChecked?: number;
  runningAppsCount: number;
}

// Project (e.g., QMS, EBMR)
export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
}

// Application
export interface App {
  id: string;
  name: string;
  projectId: string;
  serverId: string;
  domain: string; // Domain URL (e.g., pharma.qms.nexgensis.com)
  cdPath: string; // Path to docker-compose.yml directory
  autoStopTimeout: number; // in minutes (Total Run Time)
  status: 'running' | 'stopped';
  startedAt?: number; // timestamp
  timerEndsAt?: number | null; // timestamp when timer ends (for persistence)
}

// Auth
export interface AuthUser {
  username: string;
  role: UserRole;
  token: string; // JWT token
  email?: string;
  displayName?: string;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

// API Payloads for server communication
export interface DockerComposeAction {
  serverId: string;
  cdPath: string;
  action: 'up' | 'down';
}

export interface ServerStatusResponse {
  status: 'online' | 'offline';
  runningContainers: number;
}

// User Management
export interface User {
  id: string;
  username: string;
  email: string;
  fullName?: string;
  role: UserRole;
  isActive: boolean;
  createdAt: number;
  lastLogin?: number;
}

// Audit Logs
export interface AuditLog {
  id: string;
  username: string;
  action: string; // e.g., 'start_app', 'stop_app', 'create_server'
  resourceType: string; // e.g., 'app', 'server', 'project', 'user'
  resourceId: string;
  resourceName: string;
  details: string;
  createdAt: number;
}

// PostgreSQL Types
export interface PostgresContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  ports: string[];
  labels?: Record<string, string>;
  created: number;
  serverId: string;
}

export interface PostgresDatabase {
  name: string;
  owner: string;
  encoding: string;
  size?: string;
}