import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import type { Role } from '../../types/api';
import { Skeleton } from '../ui/skeleton';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: Role[];
  minRole?: Role;
  requirePasswordChanged?: boolean;
}

const ROLE_RANKS: Record<Role, number> = {
  root: 5,
  org_owner: 4,
  hr_admin: 3,
  manager: 2,
  staff: 1,
};

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  allowedRoles,
  minRole,
  requirePasswordChanged = true,
}) => {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md w-full space-y-4">
          <Skeleton className="h-10 w-48 mx-auto" />
          <Skeleton className="h-32 w-full rounded-2xl" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    );
  }

  // Not authenticated -> redirect to login
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Enforce password change if required
  if (requirePasswordChanged && user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  // Root platform user can ONLY access /platform/* and /auth/*
  if (user.role === 'root') {
    if (!location.pathname.startsWith('/platform') && !location.pathname.startsWith('/auth')) {
      return <Navigate to="/platform/organizations" replace />;
    }
  }

  // Non-root users cannot access /platform/*
  if (user.role !== 'root' && location.pathname.startsWith('/platform')) {
    return <Navigate to="/dashboard" replace />;
  }

  // Check specific allowed roles
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to={user.role === 'root' ? '/platform/organizations' : '/dashboard'} replace />;
  }

  // Check minimum role rank
  if (minRole) {
    const userRank = ROLE_RANKS[user.role] ?? 0;
    const reqRank = ROLE_RANKS[minRole] ?? 0;
    if (userRank < reqRank) {
      return <Navigate to="/dashboard" replace />;
    }
  }

  return <>{children}</>;
};
