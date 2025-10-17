import { AuditLog } from '../types/app';

// Mock API implementations
// These would connect to a real backend in production

export const auditApi = {
  async getLogs(params?: {
    limit?: number;
    offset?: number;
    action?: string;
    resourceType?: string;
  }): Promise<{ logs: AuditLog[]; total: number }> {
    // Mock implementation - returns empty logs
    // In production, this would call your backend API
    console.log('Audit logs API called with params:', params);
    
    // Return mock data for demonstration
    return {
      logs: [],
      total: 0,
    };
  },
};

export const userApi = {
  async list() {
    // Mock implementation - returns empty user list
    // In production, this would call your backend API
    console.log('User list API called');
    
    return [];
  },

  async create(userData: any) {
    // Mock implementation
    console.log('Create user API called with:', userData);
    throw new Error('User management requires backend implementation');
  },

  async update(userId: string, userData: any) {
    // Mock implementation
    console.log('Update user API called:', userId, userData);
    throw new Error('User management requires backend implementation');
  },

  async delete(userId: string) {
    // Mock implementation
    console.log('Delete user API called:', userId);
    throw new Error('User management requires backend implementation');
  },
};
