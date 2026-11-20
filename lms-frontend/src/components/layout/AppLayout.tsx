import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { roleBadgeColor } from '../../lib/utils';
import {
  Calendar,
  Clock,
  Compass,
  FileCheck,
  FileText,
  HelpCircle,
  Home,
  Layers,
  LogOut,
  Menu,
  PieChart,
  Settings,
  Shield,
  ShieldAlert,
  SunMedium,
  UserCheck,
  Users,
  X,
  Zap,
} from 'lucide-react';

export const AppLayout: React.FC = () => {
  const { user, logout, isRoot, isOrgOwner, isHrAdmin, isManager } = useAuth();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
      isActive
        ? 'bg-blue-600 text-white shadow-sm shadow-blue-200'
        : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900'
    }`;

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar for Desktop */}
      <aside className="hidden lg:flex lg:flex-col w-64 bg-white border-r border-slate-200/80 p-4 shrink-0 justify-between">
        <div className="space-y-6">
          {/* Logo & Brand */}
          <div className="flex items-center gap-2.5 px-2 py-1">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <span className="font-bold text-base tracking-tight text-slate-900 block leading-tight">
                SVMS Portal
              </span>
              <span className="text-[11px] font-medium text-slate-400 block">
                {user?.organization?.name || 'Leave Management System'}
              </span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1">
            {/* PLATFORM ROOT LINKS */}
            {isRoot && (
              <>
                <div className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-purple-600 uppercase">
                  Platform Admin
                </div>
                <NavLink to="/platform/organizations" className={navClass}>
                  <Compass className="w-4 h-4" />
                  Organizations
                </NavLink>
              </>
            )}

            {/* STAFF / PERSONAL LINKS (For non-root users) */}
            {!isRoot && (
              <>
                <div className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
                  Personal
                </div>
                <NavLink to="/dashboard" end className={navClass}>
                  <Home className="w-4 h-4" />
                  My Dashboard
                </NavLink>
                <NavLink to="/balances" className={navClass}>
                  <PieChart className="w-4 h-4" />
                  My Balances
                </NavLink>
                <NavLink to="/apply-leave" className={navClass}>
                  <Zap className="w-4 h-4 text-amber-500" />
                  Apply Leave / WFH
                </NavLink>
                <NavLink to="/my-requests" className={navClass}>
                  <Clock className="w-4 h-4" />
                  My Requests
                </NavLink>
                <NavLink to="/holidays" className={navClass}>
                  <SunMedium className="w-4 h-4 text-orange-500" />
                  Holidays
                </NavLink>
                <NavLink to="/my-team" className={navClass}>
                  <Users className="w-4 h-4" />
                  My Team
                </NavLink>
              </>
            )}

            {/* MANAGER SECTION */}
            {!isRoot && isManager && (
              <>
                <div className="px-3 pt-4 pb-1 text-[11px] font-semibold tracking-wider text-emerald-600 uppercase">
                  Manager
                </div>
                <NavLink to="/manager/dashboard" className={navClass}>
                  <Layers className="w-4 h-4" />
                  Team Dashboard
                </NavLink>
                <NavLink to="/team/availability" className={navClass}>
                  <Calendar className="w-4 h-4" />
                  Team Availability
                </NavLink>
              </>
            )}

            {/* HR ADMIN SECTION */}
            {!isRoot && isHrAdmin && (
              <>
                <div className="px-3 pt-4 pb-1 text-[11px] font-semibold tracking-wider text-blue-600 uppercase">
                  HR Management
                </div>
                <NavLink to="/hr/dashboard" className={navClass}>
                  <Layers className="w-4 h-4" />
                  HR Dashboard
                </NavLink>
                <NavLink to="/hr/approvals" className={navClass}>
                  <FileCheck className="w-4 h-4 text-emerald-600" />
                  Approvals Inbox
                </NavLink>
                <NavLink to="/hr/on-behalf" className={navClass}>
                  <UserCheck className="w-4 h-4 text-blue-600" />
                  Apply On-Behalf
                </NavLink>
                <NavLink to="/hr/users" className={navClass}>
                  <Users className="w-4 h-4" />
                  Employees
                </NavLink>
                <NavLink to="/hr/leave-types" className={navClass}>
                  <FileText className="w-4 h-4" />
                  Leave Types
                </NavLink>
                <NavLink to="/hr/schedules" className={navClass}>
                  <Clock className="w-4 h-4" />
                  Work Schedules
                </NavLink>
                <NavLink to="/hr/holidays" className={navClass}>
                  <SunMedium className="w-4 h-4" />
                  Manage Holidays
                </NavLink>
                <NavLink to="/hr/balances" className={navClass}>
                  <PieChart className="w-4 h-4" />
                  Balances & Adjustments
                </NavLink>
                <NavLink to="/hr/carry-forward" className={navClass}>
                  <Clock className="w-4 h-4" />
                  Year-End Carry Forward
                </NavLink>
                <NavLink to="/hr/reports" className={navClass}>
                  <FileText className="w-4 h-4" />
                  Reports & Export
                </NavLink>
              </>
            )}

            {/* ORG OWNER SECTION */}
            {!isRoot && isOrgOwner && (
              <>
                <div className="px-3 pt-4 pb-1 text-[11px] font-semibold tracking-wider text-amber-600 uppercase">
                  Organization Owner
                </div>
                <NavLink to="/owner/dashboard" className={navClass}>
                  <Shield className="w-4 h-4" />
                  Owner Dashboard
                </NavLink>
                <NavLink to="/org/settings" className={navClass}>
                  <Settings className="w-4 h-4" />
                  Organization Settings
                </NavLink>
                <NavLink to="/org/transfer-ownership" className={navClass}>
                  <ShieldAlert className="w-4 h-4 text-rose-500" />
                  Transfer Ownership
                </NavLink>
                <NavLink to="/org/audit-logs" className={navClass}>
                  <HelpCircle className="w-4 h-4" />
                  Audit Trail
                </NavLink>
              </>
            )}
          </nav>
        </div>

        {/* User Card & Logout in Footer */}
        <div className="pt-4 border-t border-slate-200/80 space-y-2">
          <div className="flex items-center gap-3 px-2 py-1.5 rounded-xl bg-slate-50 border border-slate-100">
            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-semibold text-xs flex items-center justify-center uppercase shrink-0">
              {user?.name?.slice(0, 2) || 'U'}
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-xs font-semibold text-slate-800 block truncate leading-tight">
                {user?.name}
              </span>
              <span className="text-[10px] text-slate-400 block truncate">{user?.email}</span>
            </div>
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase shrink-0 ${roleBadgeColor(
                user?.role,
              )}`}
            >
              {user?.role?.replace('_', ' ')}
            </span>
          </div>

          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-rose-600 hover:bg-rose-50 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile Top Header */}
        <header className="lg:hidden bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between sticky top-0 z-30">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-100"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <span className="font-bold text-slate-900 text-sm">SVMS Portal</span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase ${roleBadgeColor(
                user?.role,
              )}`}
            >
              {user?.role}
            </span>
            <button onClick={handleLogout} className="p-1.5 text-slate-500 hover:text-rose-600">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Mobile Dropdown Menu */}
        {mobileMenuOpen && (
          <div className="lg:hidden bg-white border-b border-slate-200 p-4 space-y-2 animate-in slide-in-from-top-2">
            <NavLink to="/dashboard" onClick={() => setMobileMenuOpen(false)} className={navClass}>
              My Dashboard
            </NavLink>
            <NavLink to="/apply-leave" onClick={() => setMobileMenuOpen(false)} className={navClass}>
              Apply Leave
            </NavLink>
            <NavLink to="/my-requests" onClick={() => setMobileMenuOpen(false)} className={navClass}>
              My Requests
            </NavLink>
            {isHrAdmin && (
              <NavLink to="/hr/approvals" onClick={() => setMobileMenuOpen(false)} className={navClass}>
                Approvals Inbox
              </NavLink>
            )}
          </div>
        )}

        {/* Page Content Viewport */}
        <main className="flex-1 p-4 md:p-8 max-w-7xl w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
