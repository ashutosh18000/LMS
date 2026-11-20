import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { AppLayout } from './components/layout/AppLayout';

// Auth Pages
import { LoginPage } from './pages/auth/LoginPage';
import { ChangePasswordPage } from './pages/auth/ChangePasswordPage';

// Staff Pages
import { StaffDashboardPage } from './pages/staff/StaffDashboardPage';
import { MyBalancesPage } from './pages/staff/MyBalancesPage';
import { ApplyLeavePage } from './pages/staff/ApplyLeavePage';
import { MyRequestsPage } from './pages/staff/MyRequestsPage';
import { HolidaysPage } from './pages/staff/HolidaysPage';
import { MyTeamPage } from './pages/staff/MyTeamPage';

// Manager Pages
import { ManagerDashboardPage } from './pages/manager/ManagerDashboardPage';
import { TeamAvailabilityCalendarPage } from './pages/manager/TeamAvailabilityCalendarPage';

// HR Admin Pages
import { HrDashboardPage } from './pages/hr/HrDashboardPage';
import { ApprovalsInboxPage } from './pages/hr/ApprovalsInboxPage';
import { ApplyOnBehalfPage } from './pages/hr/ApplyOnBehalfPage';
import { UsersManagementPage } from './pages/hr/UsersManagementPage';
import { LeaveTypesPage } from './pages/hr/LeaveTypesPage';
import { ScheduleTemplatesPage } from './pages/hr/ScheduleTemplatesPage';
import { ManageHolidaysPage } from './pages/hr/ManageHolidaysPage';
import { BalancesManagementPage } from './pages/hr/BalancesManagementPage';
import { CarryForwardPage } from './pages/hr/CarryForwardPage';
import { ReportsPage } from './pages/hr/ReportsPage';

// Owner Pages
import { OwnerDashboardPage } from './pages/owner/OwnerDashboardPage';
import { OrgSettingsPage } from './pages/owner/OrgSettingsPage';
import { TransferOwnershipPage } from './pages/owner/TransferOwnershipPage';
import { AuditLogsPage } from './pages/owner/AuditLogsPage';

// Platform Root Pages
import { PlatformOrganizationsPage } from './pages/platform/PlatformOrganizationsPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30, // 30 seconds caching to avoid unnecessary roundtrips
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function HomeRedirect() {
  const { user, isLoading } = useAuth();
  if (isLoading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'root') return <Navigate to="/platform/organizations" replace />;
  if (user.role === 'org_owner') return <Navigate to="/owner/dashboard" replace />;
  if (user.role === 'hr_admin') return <Navigate to="/hr/dashboard" replace />;
  if (user.role === 'manager') return <Navigate to="/manager/dashboard" replace />;
  return <Navigate to="/dashboard" replace />;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* Public Route */}
            <Route path="/login" element={<LoginPage />} />

            {/* Forced Password Change */}
            <Route
              path="/change-password"
              element={
                <ProtectedRoute requirePasswordChanged={false}>
                  <ChangePasswordPage />
                </ProtectedRoute>
              }
            />

            {/* Root Route Index */}
            <Route path="/" element={<HomeRedirect />} />

            {/* Protected Portal Routes wrapped in AppLayout */}
            <Route
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              {/* Staff Routes */}
              <Route path="/dashboard" element={<StaffDashboardPage />} />
              <Route path="/balances" element={<MyBalancesPage />} />
              <Route path="/apply-leave" element={<ApplyLeavePage />} />
              <Route path="/my-requests" element={<MyRequestsPage />} />
              <Route path="/holidays" element={<HolidaysPage />} />
              <Route path="/my-team" element={<MyTeamPage />} />

              {/* Manager Routes */}
              <Route
                path="/manager/dashboard"
                element={
                  <ProtectedRoute minRole="manager">
                    <ManagerDashboardPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/team/availability"
                element={
                  <ProtectedRoute minRole="manager">
                    <TeamAvailabilityCalendarPage />
                  </ProtectedRoute>
                }
              />

              {/* HR Admin Routes */}
              <Route
                path="/hr/dashboard"
                element={
                  <ProtectedRoute minRole="hr_admin">
                    <HrDashboardPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/hr/approvals"
                element={
                  <ProtectedRoute minRole="hr_admin">
                    <ApprovalsInboxPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/hr/on-behalf"
                element={
                  <ProtectedRoute minRole="hr_admin">
                    <ApplyOnBehalfPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/hr/users"
                element={
                  <ProtectedRoute minRole="hr_admin">
                    <UsersManagementPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/hr/leave-types"
                element={
                  <ProtectedRoute minRole="hr_admin">
                    <LeaveTypesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/hr/schedules"
                element={
                  <ProtectedRoute minRole="hr_admin">
                    <ScheduleTemplatesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/hr/holidays"
                element={
                  <ProtectedRoute minRole="hr_admin">
                    <ManageHolidaysPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/hr/balances"
                element={
                  <ProtectedRoute minRole="hr_admin">
                    <BalancesManagementPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/hr/carry-forward"
                element={
                  <ProtectedRoute minRole="hr_admin">
                    <CarryForwardPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/hr/reports"
                element={
                  <ProtectedRoute minRole="hr_admin">
                    <ReportsPage />
                  </ProtectedRoute>
                }
              />

              {/* Org Owner Routes */}
              <Route
                path="/owner/dashboard"
                element={
                  <ProtectedRoute allowedRoles={['org_owner']}>
                    <OwnerDashboardPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/org/settings"
                element={
                  <ProtectedRoute allowedRoles={['org_owner']}>
                    <OrgSettingsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/org/transfer-ownership"
                element={
                  <ProtectedRoute allowedRoles={['org_owner']}>
                    <TransferOwnershipPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/org/audit-logs"
                element={
                  <ProtectedRoute allowedRoles={['org_owner', 'hr_admin']}>
                    <AuditLogsPage />
                  </ProtectedRoute>
                }
              />

              {/* Platform Superadmin Routes */}
              <Route
                path="/platform/organizations"
                element={
                  <ProtectedRoute allowedRoles={['root']}>
                    <PlatformOrganizationsPage />
                  </ProtectedRoute>
                }
              />
            </Route>

            {/* Fallback */}
            <Route path="*" element={<HomeRedirect />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
