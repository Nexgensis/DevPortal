import { useState, useEffect } from 'react';
import { AuthUser, LoginCredentials, UserRole } from '../types/app';

const AUTH_STORAGE_KEY = 'devops-dashboard-auth';

// Mock authentication - In production, this would call a real backend API
const MOCK_USERS: Array<{ username: string; password: string; role: UserRole }> = [
  { username: 'admin', password: 'admin123', role: 'admin' },
  { username: 'devops', password: 'devops123', role: 'user' },
  { username: 'user', password: 'user123', role: 'user' },
];

// Simple JWT mock generator
function generateMockJWT(username: string, role: UserRole): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({ 
    username, 
    role,
    exp: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
    iat: Date.now() 
  }));
  const signature = btoa(`mock-signature-${username}-${Date.now()}`);
  return `${header}.${payload}.${signature}`;
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
      try {
        const authUser = JSON.parse(stored) as AuthUser;
        // Ensure role exists (migration for existing users)
        if (!authUser.role) {
          authUser.role = authUser.username === 'admin' ? 'admin' : 'user';
        }
        setUser(authUser);
      } catch (error) {
        console.error('Failed to parse auth from localStorage:', error);
        localStorage.removeItem(AUTH_STORAGE_KEY);
      }
    }
    setIsLoading(false);
  }, []);

  const login = async (credentials: LoginCredentials): Promise<boolean> => {
    // Mock authentication - In production, this would be an API call
    const mockUser = MOCK_USERS.find(
      u => u.username === credentials.username && u.password === credentials.password
    );

    if (!mockUser) {
      return false;
    }

    const token = generateMockJWT(credentials.username, mockUser.role);
    const authUser: AuthUser = {
      username: credentials.username,
      role: mockUser.role,
      token,
    };

    setUser(authUser);
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authUser));
    return true;
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem(AUTH_STORAGE_KEY);
  };

  const isAdmin = user?.role === 'admin';

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    isAdmin,
    login,
    logout,
  };
}
