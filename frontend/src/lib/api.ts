import { Server, Project, App, AuthUser, LoginCredentials, User, AuditLog } from '../types/app';

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) 
    ? `${import.meta.env.VITE_API_URL}/api` 
    : '/api';

// Helper function to get auth headers
function getAuthHeaders(): HeadersInit {
    const auth = localStorage.getItem('devops-dashboard-auth');
    if (auth) {
        const { token } = JSON.parse(auth);
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        };
    }
    return {
        'Content-Type': 'application/json',
    };
}

// Helper function to handle API responses
async function handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Network error' }));
        throw new Error(error.error || `HTTP ${response.status}`);
    }
    return response.json();
}

// Authentication API
export const authApi = {
    async login(credentials: LoginCredentials): Promise<{ token: string }> {
        const response = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(credentials),
        });
        return handleResponse(response);
    },

    async verify(): Promise<{ user: { username: string; role: string } }> {
        const response = await fetch(`${API_BASE}/auth/verify`, {
            headers: getAuthHeaders(),
        });
        return handleResponse(response);
    },

    async logout(): Promise<{ message: string }> {
        const response = await fetch(`${API_BASE}/auth/logout`, {
            method: 'POST',
            headers: getAuthHeaders(),
        });
        return handleResponse(response);
    },
};

// Server API
export const serverApi = {
    async list(): Promise<Server[]> {
        const response = await fetch(`${API_BASE}/servers`, {
            headers: getAuthHeaders(),
        });
        return handleResponse(response);
    },

    async create(server: Omit<Server, 'id' | 'status' | 'lastChecked' | 'runningAppsCount'>): Promise<Server> {
        const response = await fetch(`${API_BASE}/servers`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(server),
        });
        return handleResponse(response);
    },

    async update(id: string, server: Partial<Server>): Promise<Server> {
        const response = await fetch(`${API_BASE}/servers/${id}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(server),
        });
        return handleResponse(response);
    },

    async delete(id: string): Promise<{ message: string }> {
        const response = await fetch(`${API_BASE}/servers/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders(),
        });
        return handleResponse(response);
    },

    async testConnection(id: string): Promise<{
        status: string;
        runningAppsCount: number;
        lastChecked: number;
    }> {
        const response = await fetch(`${API_BASE}/servers/${id}/test`, {
            method: 'POST',
            headers: getAuthHeaders(),
        });
        return handleResponse(response);
    },

    async refreshAll(): Promise<{
        message: string;
        servers: Server[];
    }> {
        const response = await fetch(`${API_BASE}/servers/refresh`, {
            method: 'POST',
            headers: getAuthHeaders(),
        });
        return handleResponse(response);
    },
};

// Project API
export const projectApi = {
    async list(): Promise<Project[]> {
        const response = await fetch(`${API_BASE}/projects`, {
            headers: getAuthHeaders(),
        });
        return handleResponse(response);
    },

    async create(project: Omit<Project, 'id' | 'createdAt'>): Promise<Project> {
        const response = await fetch(`${API_BASE}/projects`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(project),
        });
        return handleResponse(response);
    },

    async update(id: string, project: Partial<Project>): Promise<Project> {
        const response = await fetch(`${API_BASE}/projects/${id}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(project),
        });
        return handleResponse(response);
    },

    async delete(id: string): Promise<{ message: string }> {
        const response = await fetch(`${API_BASE}/projects/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders(),
        });
        return handleResponse(response);
    },
};

// App API
export const appApi = {
    async list(): Promise<App[]> {
        const response = await fetch(`${API_BASE}/apps`, {
            headers: getAuthHeaders(),
        });
        return handleResponse(response);
    },

    async create(app: Omit<App, 'id' | 'status' | 'startedAt'>): Promise<App> {
        const response = await fetch(`${API_BASE}/apps`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(app),
        });
        return handleResponse(response);
    },

    async update(id: string, app: Partial<App>): Promise<App> {
        const response = await fetch(`${API_BASE}/apps/${id}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(app),
        });
        return handleResponse(response);
    },

    async delete(id: string): Promise<{ message: string }> {
        const response = await fetch(`${API_BASE}/apps/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders(),
        });
        return handleResponse(response);
    },

    async start(id: string, timeoutMinutes: number): Promise<{
        message: string;
        output: string;
        timer_ends_at: number;
        app_url?: string;
    }> {
        const response = await fetch(`${API_BASE}/apps/${id}/start`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ timeout_minutes: timeoutMinutes }),
        });
        return handleResponse(response);
    },

    async stop(id: string): Promise<{
        message: string;
        output: string;
    }> {
        const response = await fetch(`${API_BASE}/apps/${id}/stop`, {
            method: 'POST',
            headers: getAuthHeaders(),
        });
        return handleResponse(response);
    },
};

// User API
export const userApi = {
    async list(): Promise<User[]> {
        const response = await fetch(`${API_BASE}/users`, {
            headers: getAuthHeaders(),
        });
        return handleResponse(response);
    },

    async create(user: {
        username: string;
        email: string;
        fullName?: string;
        password: string;
        role: string;
    }): Promise<User> {
        const response = await fetch(`${API_BASE}/users`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(user),
        });
        return handleResponse(response);
    },

    async update(id: string, user: {
        username?: string;
        email?: string;
        fullName?: string;
        role?: string;
        isActive?: boolean;
    }): Promise<User> {
        const response = await fetch(`${API_BASE}/users/${id}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(user),
        });
        return handleResponse(response);
    },

    async delete(id: string): Promise<{ message: string }> {
        const response = await fetch(`${API_BASE}/users/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders(),
        });
        return handleResponse(response);
    },
};

// Audit API
export const auditApi = {
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
        const searchParams = new URLSearchParams();
        if (params?.limit) searchParams.append('limit', params.limit.toString());
        if (params?.offset) searchParams.append('offset', params.offset.toString());
        if (params?.userId) searchParams.append('userId', params.userId);
        if (params?.action) searchParams.append('action', params.action);
        if (params?.resourceType) searchParams.append('resourceType', params.resourceType);

        const response = await fetch(`${API_BASE}/audit-logs?${searchParams}`, {
            headers: getAuthHeaders(),
        });
        return handleResponse(response);
    },
};

// Postgres API
export const postgresApi = {
    async listContainers(serverId: string): Promise<{ containers: any[]; count: number }> {
        const response = await fetch(`${API_BASE}/servers/${serverId}/postgres/containers`, {
            headers: getAuthHeaders(),
        });
        return handleResponse(response);
    },

    async listDatabases(serverId: string, containerId: string): Promise<{ databases: any[]; count: number }> {
        const response = await fetch(`${API_BASE}/servers/${serverId}/postgres/containers/${containerId}/databases`, {
            headers: getAuthHeaders(),
        });
        return handleResponse(response);
    },

    async testConnection(serverId: string, containerId: string): Promise<{ status: string; message: string }> {
        const response = await fetch(`${API_BASE}/servers/${serverId}/postgres/containers/${containerId}/test`, {
            method: 'POST',
            headers: getAuthHeaders(),
        });
        return handleResponse(response);
    },

    async createDump(request: {
        server_id: string;
        container_id: string;
        database: string;
    }): Promise<Blob> {
        const response = await fetch(`${API_BASE}/postgres/dump`, {
            method: 'POST',
            headers: {
                ...getAuthHeaders(),
                'Accept': 'application/octet-stream',
            } as any,
            body: JSON.stringify(request),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Network error' }));
            throw new Error(error.error || `HTTP ${response.status}`);
        }

        return response.blob();
    },
};