import React, { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AuthUser, Role } from '../types/api';
import {
  apiRequest,
  setMemoryAccessToken,
  silentRefreshToken,
  setOnUnauthorized,
} from '../lib/api-client';

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, pass: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  updateUserPasswordFlag: (mustChange: boolean) => void;
  hasRole: (minRole: Role) => boolean;
  isRoot: boolean;
  isOrgOwner: boolean;
  isHrAdmin: boolean;
  isManager: boolean;
  isStaff: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const ROLE_RANKS: Record<Role, number> = {
  root: 5,
  org_owner: 4,
  hr_admin: 3,
  manager: 2,
  staff: 1,
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Initialize: attempt silent refresh via httpOnly cookie on first page mount
  useEffect(() => {
    let mounted = true;

    async function initAuth() {
      try {
        const token = await silentRefreshToken();
        if (token && mounted) {
          const me = await apiRequest<AuthUser>('/auth/me');
          if (mounted) setUser(me);
        }
      } catch {
        if (mounted) setUser(null);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    setOnUnauthorized(() => {
      setUser(null);
      setMemoryAccessToken(null);
    });

    initAuth();

    return () => {
      mounted = false;
    };
  }, []);

  const login = async (email: string, password: string): Promise<AuthUser> => {
    const res = await apiRequest<{ accessToken: string; user: AuthUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      skipAuth: true,
    });

    setMemoryAccessToken(res.accessToken);
    setUser(res.user);
    return res.user;
  };

  const logout = async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network failures on logout
    } finally {
      setMemoryAccessToken(null);
      setUser(null);
    }
  };

  const updateUserPasswordFlag = (mustChange: boolean) => {
    if (user) {
      setUser({ ...user, mustChangePassword: mustChange });
    }
  };

  const hasRole = (minRole: Role): boolean => {
    if (!user) return false;
    // Root is platform superadmin
    if (user.role === 'root') return minRole === 'root';
    return (ROLE_RANKS[user.role] ?? 0) >= (ROLE_RANKS[minRole] ?? 0);
  };

  const isRoot = user?.role === 'root';
  const isOrgOwner = user?.role === 'org_owner';
  const isHrAdmin = user?.role === 'hr_admin' || isOrgOwner;
  const isManager = user?.role === 'manager' || isHrAdmin;
  const isStaff = !!user && !isRoot;

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        login,
        logout,
        updateUserPasswordFlag,
        hasRole,
        isRoot,
        isOrgOwner,
        isHrAdmin,
        isManager,
        isStaff,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
