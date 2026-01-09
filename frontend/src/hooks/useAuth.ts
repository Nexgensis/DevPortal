import { useState, useEffect } from 'react';
import { AuthUser, UserRole } from '../types/app';
import { toast } from 'sonner';

const AUTH_STORAGE_KEY = 'devops-dashboard-auth';
const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL)
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const initAuth = async () => {
      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
      if (stored) {
        try {
          const authData = JSON.parse(stored);

          // Validate token with backend
          const isValid = await validateToken(authData.token);

          if (isValid) {
            setUser(authData);
          } else {
            // Token is invalid, clear storage
            localStorage.removeItem(AUTH_STORAGE_KEY);
            setUser(null);
          }
        } catch (error) {
          console.error('Failed to parse auth from localStorage:', error);
          localStorage.removeItem(AUTH_STORAGE_KEY);
          setUser(null);
        }
      }
      setIsLoading(false);
    };

    initAuth();
  }, []);

  const validateToken = async (token: string): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE}/auth/verify`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      return response.ok;
    } catch (error) {
      console.error('Token validation failed:', error);
      return false;
    }
  };

  const getUserProfile = async (token: string): Promise<AuthUser | null> => {
    try {
      const response = await fetch(`${API_BASE}/auth/verify`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to get user profile');
      }

      const data = await response.json();

      // Map backend response to AuthUser - backend returns { user: { username, role } }
      return {
        username: data.user?.username || 'user',
        role: (data.user?.role || 'user') as UserRole,
        token: token,
        email: data.user?.email,
        displayName: data.user?.username,
      };
    } catch (error) {
      console.error('Failed to get user profile:', error);
      return null;
    }
  };

  const setAuthToken = async (token: string): Promise<boolean> => {
    try {
      // Get user profile from backend
      const userProfile = await getUserProfile(token);

      if (!userProfile) {
        throw new Error('Failed to retrieve user profile');
      }

      setUser(userProfile);
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(userProfile));

      // Dispatch custom event to notify other hooks
      window.dispatchEvent(new CustomEvent('auth-login'));

      toast.success('Successfully signed in!');
      return true;
    } catch (error) {
      console.error('SSO Authentication failed:', error);
      localStorage.removeItem(AUTH_STORAGE_KEY);
      setUser(null);
      toast.error('Authentication failed');
      return false;
    }
  };

  const login = async (credentials: { username: string; password: string }): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(credentials),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Login failed' }));
        throw new Error(error.error || 'Invalid credentials');
      }

      const data = await response.json();

      if (data.token) {
        return await setAuthToken(data.token);
      }

      throw new Error('No token received');
    } catch (error) {
      console.error('Login failed:', error);
      toast.error(error instanceof Error ? error.message : 'Login failed');
      return false;
    }
  };

  const logout = async () => {
    try {
      if (user?.token) {
        // Call backend logout endpoint
        await fetch(`${API_BASE}/auth/logout`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${user.token}`,
            'Content-Type': 'application/json',
          },
        });
      }
    } catch (error) {
      console.error('Logout request failed:', error);
    } finally {
      setUser(null);
      localStorage.removeItem(AUTH_STORAGE_KEY);
      toast.success('Signed out successfully');
    }
  };

  const isAdmin = user?.role === 'admin';

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    isAdmin,
    login,
    logout,
    setAuthToken,
  };
}

