import { Server, Project, App, User } from '../types/app';
import { PostgresContainer, PostgresDatabase } from '../types/postgres';

const STORAGE_KEY_SERVERS = 'devops-dashboard-mock-servers';
const STORAGE_KEY_PROJECTS = 'devops-dashboard-mock-projects';
const STORAGE_KEY_APPS = 'devops-dashboard-mock-apps';
const STORAGE_KEY_USERS = 'devops-dashboard-mock-users';

// Initial mock data
const INITIAL_SERVERS: Server[] = [
  {
    id: 'server-1',
    name: 'Production Server',
    host: '192.168.1.100',
    port: 22,
    username: 'deploy',
    privateKey: '-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----',
    status: 'online',
    runningAppsCount: 3,
    lastChecked: Date.now() - 5 * 60 * 1000, // 5 minutes ago
  },
  {
    id: 'server-2',
    name: 'Staging Server',
    host: '192.168.1.101',
    port: 22,
    username: 'deploy',
    privateKey: '-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----',
    status: 'online',
    runningAppsCount: 2,
    lastChecked: Date.now() - 2 * 60 * 1000, // 2 minutes ago
  },
  {
    id: 'server-3',
    name: 'Development Server',
    host: '192.168.1.102',
    port: 22,
    username: 'deploy',
    privateKey: '-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----',
    status: 'online',
    runningAppsCount: 1,
    lastChecked: Date.now() - 10 * 60 * 1000, // 10 minutes ago
  },
];

const INITIAL_PROJECTS: Project[] = [
  {
    id: 'project-1',
    name: 'QMS',
    description: 'Quality Management System',
    createdAt: Date.now() - 90 * 24 * 60 * 60 * 1000, // 90 days ago
  },
  {
    id: 'project-2',
    name: 'EBMR',
    description: 'Electronic Batch Manufacturing Records',
    createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000, // 60 days ago
  },
  {
    id: 'project-3',
    name: 'Analytics',
    description: 'Business Intelligence & Analytics Platform',
    createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 days ago
  },
];

const INITIAL_APPS: App[] = [
  // QMS Apps
  {
    id: 'app-1',
    name: 'QMS Frontend',
    projectId: 'project-1',
    serverId: 'server-1',
    domain: 'qms.example.com',
    composePath: '/opt/apps/qms-frontend/docker-compose.yml',
    status: 'running',
    startedAt: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
    timerEndsAt: Date.now() + 6 * 60 * 60 * 1000, // 6 hours from now
  },
  {
    id: 'app-2',
    name: 'QMS Backend API',
    projectId: 'project-1',
    serverId: 'server-1',
    domain: 'api.qms.example.com',
    composePath: '/opt/apps/qms-backend/docker-compose.yml',
    status: 'running',
    startedAt: Date.now() - 2 * 60 * 60 * 1000,
    timerEndsAt: null, // No auto-stop
  },
  {
    id: 'app-3',
    name: 'QMS Database',
    projectId: 'project-1',
    serverId: 'server-1',
    domain: 'db.qms.example.com',
    composePath: '/opt/apps/qms-db/docker-compose.yml',
    status: 'running',
    startedAt: Date.now() - 5 * 24 * 60 * 60 * 1000, // 5 days ago
    timerEndsAt: null,
  },
  // EBMR Apps
  {
    id: 'app-4',
    name: 'EBMR Portal',
    projectId: 'project-2',
    serverId: 'server-2',
    domain: 'ebmr.example.com',
    composePath: '/opt/apps/ebmr-portal/docker-compose.yml',
    status: 'running',
    startedAt: Date.now() - 4 * 60 * 60 * 1000,
    timerEndsAt: Date.now() + 4 * 60 * 60 * 1000,
  },
  {
    id: 'app-5',
    name: 'EBMR Services',
    projectId: 'project-2',
    serverId: 'server-2',
    domain: 'services.ebmr.example.com',
    composePath: '/opt/apps/ebmr-services/docker-compose.yml',
    status: 'stopped',
  },
  // Analytics Apps
  {
    id: 'app-6',
    name: 'Analytics Dashboard',
    projectId: 'project-3',
    serverId: 'server-3',
    domain: 'analytics.example.com',
    composePath: '/opt/apps/analytics-dashboard/docker-compose.yml',
    status: 'stopped',
  },
  {
    id: 'app-7',
    name: 'Data Warehouse',
    projectId: 'project-3',
    serverId: 'server-2',
    domain: 'warehouse.analytics.example.com',
    composePath: '/opt/apps/data-warehouse/docker-compose.yml',
    status: 'running',
    startedAt: Date.now() - 24 * 60 * 60 * 1000, // 1 day ago
    timerEndsAt: null,
  },
];

const INITIAL_USERS: User[] = [
  {
    id: 'user-1',
    username: 'admin',
    email: 'admin@example.com',
    fullName: 'Admin User',
    role: 'admin',
    isActive: true,
    createdAt: Date.now() - 90 * 24 * 60 * 60 * 1000,
    lastLogin: Date.now() - 1 * 60 * 60 * 1000,
  },
  {
    id: 'user-2',
    username: 'john.doe',
    email: 'john.doe@example.com',
    fullName: 'John Doe',
    role: 'user',
    isActive: true,
    createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
    lastLogin: Date.now() - 5 * 60 * 60 * 1000,
  },
  {
    id: 'user-3',
    username: 'jane.smith',
    email: 'jane.smith@example.com',
    fullName: 'Jane Smith',
    role: 'user',
    isActive: true,
    createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
    lastLogin: Date.now() - 2 * 24 * 60 * 60 * 1000,
  },
  {
    id: 'user-4',
    username: 'bob.wilson',
    email: 'bob.wilson@example.com',
    fullName: 'Bob Wilson',
    role: 'user',
    isActive: false,
    createdAt: Date.now() - 120 * 24 * 60 * 60 * 1000,
  },
];

// Mock data store functions
export const mockDataStore = {
  // Servers
  getServers(): Server[] {
    const stored = localStorage.getItem(STORAGE_KEY_SERVERS);
    if (stored) {
      return JSON.parse(stored);
    }
    localStorage.setItem(STORAGE_KEY_SERVERS, JSON.stringify(INITIAL_SERVERS));
    return INITIAL_SERVERS;
  },

  setServers(servers: Server[]): void {
    localStorage.setItem(STORAGE_KEY_SERVERS, JSON.stringify(servers));
  },

  // Projects
  getProjects(): Project[] {
    const stored = localStorage.getItem(STORAGE_KEY_PROJECTS);
    if (stored) {
      return JSON.parse(stored);
    }
    localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(INITIAL_PROJECTS));
    return INITIAL_PROJECTS;
  },

  setProjects(projects: Project[]): void {
    localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(projects));
  },

  // Apps
  getApps(): App[] {
    const stored = localStorage.getItem(STORAGE_KEY_APPS);
    if (stored) {
      return JSON.parse(stored);
    }
    localStorage.setItem(STORAGE_KEY_APPS, JSON.stringify(INITIAL_APPS));
    return INITIAL_APPS;
  },

  setApps(apps: App[]): void {
    localStorage.setItem(STORAGE_KEY_APPS, JSON.stringify(apps));
  },

  // Users
  getUsers(): User[] {
    const stored = localStorage.getItem(STORAGE_KEY_USERS);
    if (stored) {
      return JSON.parse(stored);
    }
    localStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(INITIAL_USERS));
    return INITIAL_USERS;
  },

  setUsers(users: User[]): void {
    localStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(users));
  },

  // Reset to initial data
  reset(): void {
    localStorage.setItem(STORAGE_KEY_SERVERS, JSON.stringify(INITIAL_SERVERS));
    localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(INITIAL_PROJECTS));
    localStorage.setItem(STORAGE_KEY_APPS, JSON.stringify(INITIAL_APPS));
    localStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(INITIAL_USERS));
  },
};