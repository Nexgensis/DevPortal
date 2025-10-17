import { useState, useEffect } from 'react';
import { AuthUser, LoginCredentials, UserRole } from '../types/app';
import { authApi } from '../lib/api';

const AUTH_STORAGE_KEY = 'devops-dashboard-auth';

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
      try {
        const authUser = JSON.parse(stored) as AuthUser;
        // Verify token is still valid by calling the API
        authApi.verify()
          .then((response) => {
            // Update user info from server response
            const updatedUser = {
              ...authUser,
              username: response.user.username,
              role: response.user.role as UserRole
            };
            setUser(updatedUser);
            localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(updatedUser));
          })
          .catch(() => {
            // Token is invalid, remove it
            localStorage.removeItem(AUTH_STORAGE_KEY);
            setUser(null);
          })
          .finally(() => {
            setIsLoading(false);
          });
      } catch (error) {
        console.error('Failed to parse auth from localStorage:', error);
        localStorage.removeItem(AUTH_STORAGE_KEY);
        setIsLoading(false);
      }
    } else {
      setIsLoading(false);
    }
  }, []);

  const login = async (credentials: LoginCredentials): Promise<boolean> => {
    try {
      const response = await authApi.login(credentials);
      
      // Store token temporarily to make verify call
      const tempAuthUser: AuthUser = {
        username: credentials.username,
        role: 'user', // temporary, will be updated from verify
        token: response.token,
      };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(tempAuthUser));
      
      // Get user details from verify endpoint
      const userResponse = await authApi.verify();
      
      const authUser: AuthUser = {
        username: userResponse.user.username,
        role: userResponse.user.role as UserRole,
        token: response.token,
      };

      setUser(authUser);
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authUser));
      return true;
    } catch (error) {
      console.error('Login failed:', error);
      localStorage.removeItem(AUTH_STORAGE_KEY);
      return false;
    }
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } catch (error) {
      console.error('Logout API call failed:', error);
    } finally {
      setUser(null);
      localStorage.removeItem(AUTH_STORAGE_KEY);
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
  };
}
