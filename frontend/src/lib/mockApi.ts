import { Server, Project, App, LoginCredentials, User, AuditLog } from '../types/app';

// Mock user database
const MOCK_USERS = [
  { username: 'admin', password: 'admin123', role: 'admin', email: 'admin@devops.local', fullName: 'Admin User' },
  { username: 'devops', password: 'devops123', role: 'user', email: 'devops@devops.local', fullName: 'DevOps User' },
  { username: 'user', password: 'user123', role: 'user', email: 'user@devops.local', fullName: 'Regular User' },
];

// Generate a simple token
function generateToken(username: string): string {
  return btoa(`${username}:${Date.now()}`);
}

// Verify token
function verifyToken(token: string): { username: string; role: string } | null {
  try {
    const decoded = atob(token);
    const [username] = decoded.split(':');
    const user = MOCK_USERS.find(u => u.username === username);
    if (user) {
      return { username: user.username, role: user.role };
    }
    return null;
  } catch {
    return null;
  }
}

// Mock Authentication API
export const mockAuthApi = {
  async login(credentials: LoginCredentials): Promise<{ token: string }> {
    await new Promise(resolve => setTimeout(resolve, 500)); // Simulate network delay
    
    const user = MOCK_USERS.find(
      u => u.username === credentials.username && u.password === credentials.password
    );
    
    if (!user) {
      throw new Error('Invalid username or password');
    }
    
    return { token: generateToken(user.username) };
  },

  async verify(token: string): Promise<{ user: { username: string; role: string } }> {
    await new Promise(resolve => setTimeout(resolve, 200));
    
    const user = verifyToken(token);
    if (!user) {
      throw new Error('Invalid token');
    }
    
    return { user };
  },

  async logout(): Promise<{ message: string }> {
    await new Promise(resolve => setTimeout(resolve, 200));
    return { message: 'Logged out successfully' };
  },
};

// Helper to get token from localStorage
function getToken(): string | null {
  const auth = localStorage.getItem('devops-dashboard-auth');
  if (auth) {
    try {
      const { token } = JSON.parse(auth);
      return token;
    } catch {
      return null;
    }
  }
  return null;
}

// Helper to verify authentication
function requireAuth() {
  const token = getToken();
  if (!token) {
    throw new Error('Not authenticated');
  }
  const user = verifyToken(token);
  if (!user) {
    throw new Error('Invalid token');
  }
  return user;
}

// Mock Server API
export const mockServerApi = {
  async list(): Promise<Server[]> {
    requireAuth();
    const stored = localStorage.getItem('devops-servers');
    return stored ? JSON.parse(stored) : [];
  },

  async create(server: Omit<Server, 'id' | 'status' | 'lastChecked' | 'runningAppsCount'>): Promise<Server> {
    requireAuth();
    const servers = await this.list();
    const newServer: Server = {
      ...server,
      id: `server-${Date.now()}`,
      status: 'offline',
      lastChecked: Date.now(),
      runningAppsCount: 0,
    };
    servers.push(newServer);
    localStorage.setItem('devops-servers', JSON.stringify(servers));
    return newServer;
  },

  async update(id: string, updates: Partial<Server>): Promise<Server> {
    requireAuth();
    const servers = await this.list();
    const index = servers.findIndex(s => s.id === id);
    if (index === -1) throw new Error('Server not found');
    servers[index] = { ...servers[index], ...updates };
    localStorage.setItem('devops-servers', JSON.stringify(servers));
    return servers[index];
  },

  async delete(id: string): Promise<{ message: string }> {
    requireAuth();
    const servers = await this.list();
    const filtered = servers.filter(s => s.id !== id);
    localStorage.setItem('devops-servers', JSON.stringify(filtered));
    return { message: 'Server deleted' };
  },

  async testConnection(id: string): Promise<{ status: string; runningAppsCount: number; lastChecked: number }> {
    requireAuth();
    // Simulate connection test
    return {
      status: 'online',
      runningAppsCount: 0,
      lastChecked: Date.now(),
    };
  },

  async refreshAll(): Promise<{ message: string; servers: Server[] }> {
    requireAuth();
    const servers = await this.list();
    return { message: 'Refreshed all servers', servers };
  },
};

// Mock Project API
export const mockProjectApi = {
  async list(): Promise<Project[]> {
    requireAuth();
    const stored = localStorage.getItem('devops-projects');
    return stored ? JSON.parse(stored) : [];
  },

  async create(project: Omit<Project, 'id' | 'createdAt'>): Promise<Project> {
    requireAuth();
    const projects = await this.list();
    const newProject: Project = {
      ...project,
      id: `project-${Date.now()}`,
      createdAt: Date.now(),
    };
    projects.push(newProject);
    localStorage.setItem('devops-projects', JSON.stringify(projects));
    return newProject;
  },

  async update(id: string, updates: Partial<Project>): Promise<Project> {
    requireAuth();
    const projects = await this.list();
    const index = projects.findIndex(p => p.id === id);
    if (index === -1) throw new Error('Project not found');
    projects[index] = { ...projects[index], ...updates };
    localStorage.setItem('devops-projects', JSON.stringify(projects));
    return projects[index];
  },

  async delete(id: string): Promise<{ message: string }> {
    requireAuth();
    const projects = await this.list();
    const filtered = projects.filter(p => p.id !== id);
    localStorage.setItem('devops-projects', JSON.stringify(filtered));
    return { message: 'Project deleted' };
  },
};

// Mock App API
export const mockAppApi = {
  async list(): Promise<App[]> {
    requireAuth();
    const stored = localStorage.getItem('devops-apps');
    return stored ? JSON.parse(stored) : [];
  },

  async create(app: Omit<App, 'id' | 'status' | 'startedAt'>): Promise<App> {
    requireAuth();
    const apps = await this.list();
    const newApp: App = {
      ...app,
      id: `app-${Date.now()}`,
      status: 'stopped',
      startedAt: null,
      timerEndsAt: null,
    };
    apps.push(newApp);
    localStorage.setItem('devops-apps', JSON.stringify(apps));
    return newApp;
  },

  async update(id: string, updates: Partial<App>): Promise<App> {
    requireAuth();
    const apps = await this.list();
    const index = apps.findIndex(a => a.id === id);
    if (index === -1) throw new Error('App not found');
    apps[index] = { ...apps[index], ...updates };
    localStorage.setItem('devops-apps', JSON.stringify(apps));
    return apps[index];
  },

  async delete(id: string): Promise<{ message: string }> {
    requireAuth();
    const apps = await this.list();
    const filtered = apps.filter(a => a.id !== id);
    localStorage.setItem('devops-apps', JSON.stringify(filtered));
    return { message: 'App deleted' };
  },

  async start(id: string, timeoutMinutes: number): Promise<{
    message: string;
    output: string;
    timer_ends_at: number;
    app_url?: string;
  }> {
    requireAuth();
    await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate start delay
    
    const apps = await this.list();
    const app = apps.find(a => a.id === id);
    if (!app) throw new Error('App not found');
    
    const timerEndsAt = Date.now() + (timeoutMinutes * 60 * 1000);
    
    return {
      message: 'App started successfully',
      output: 'Docker Compose started',
      timer_ends_at: timerEndsAt,
      app_url: app.domain.startsWith('http') ? app.domain : `https://${app.domain}`,
    };
  },

  async stop(id: string): Promise<{ message: string; output: string }> {
    requireAuth();
    await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate stop delay
    
    return {
      message: 'App stopped successfully',
      output: 'Docker Compose stopped',
    };
  },
};

// Mock User API
export const mockUserApi = {
  async list(): Promise<User[]> {
    requireAuth();
    const stored = localStorage.getItem('devops-users');
    if (stored) {
      return JSON.parse(stored);
    }
    // Return default users
    const defaultUsers: User[] = MOCK_USERS.map((u, index) => ({
      id: `user-${index}`,
      username: u.username,
      email: u.email,
      fullName: u.fullName,
      role: u.role,
      createdAt: Date.now() - (index * 86400000), // Stagger creation dates
      isActive: true,
    }));
    localStorage.setItem('devops-users', JSON.stringify(defaultUsers));
    return defaultUsers;
  },

  async create(user: {
    username: string;
    email: string;
    fullName?: string;
    password: string;
    role: string;
  }): Promise<User> {
    requireAuth();
    const users = await this.list();
    const newUser: User = {
      id: `user-${Date.now()}`,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      createdAt: Date.now(),
      isActive: true,
    };
    users.push(newUser);
    localStorage.setItem('devops-users', JSON.stringify(users));
    return newUser;
  },

  async update(id: string, updates: Partial<User>): Promise<User> {
    requireAuth();
    const users = await this.list();
    const index = users.findIndex(u => u.id === id);
    if (index === -1) throw new Error('User not found');
    users[index] = { ...users[index], ...updates };
    localStorage.setItem('devops-users', JSON.stringify(users));
    return users[index];
  },

  async delete(id: string): Promise<{ message: string }> {
    requireAuth();
    const users = await this.list();
    const filtered = users.filter(u => u.id !== id);
    localStorage.setItem('devops-users', JSON.stringify(filtered));
    return { message: 'User deleted' };
  },
};

// Mock Audit API
export const mockAuditApi = {
  async getLogs(params?: {
    limit?: number;
    offset?: number;
    userId?: string;
    action?: string;
    resourceType?: string;
  }): Promise<{
    logs: AuditLog[];
    total: number;
    limit: number;
    offset: number;
  }> {
    requireAuth();
    const stored = localStorage.getItem('devops-audit-logs');
    const allLogs: AuditLog[] = stored ? JSON.parse(stored) : [];
    
    const limit = params?.limit || 50;
    const offset = params?.offset || 0;
    
    return {
      logs: allLogs.slice(offset, offset + limit),
      total: allLogs.length,
      limit,
      offset,
    };
  },
};
