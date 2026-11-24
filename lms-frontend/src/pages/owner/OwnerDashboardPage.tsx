import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiRequest } from '../../lib/api-client';
import type { DashboardOwnerResponse } from '../../types/api';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { Button } from '../../components/ui/button';
import { Shield, Settings, Users, UserCheck, Clock, AlertCircle } from 'lucide-react';
import { formatCalendarDate } from '../../lib/utils';

export const OwnerDashboardPage: React.FC = () => {
  const { data, isLoading, error } = useQuery<DashboardOwnerResponse>({
    queryKey: ['dashboard-owner'],
    queryFn: () => apiRequest<DashboardOwnerResponse>('/dashboard/owner'),
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <span>Failed to load organization owner dashboard.</span>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Organization Owner Dashboard</h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200 uppercase">
              Owner Overview
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Organization governance, workforce metrics, and audit activity
          </p>
        </div>
        <Link to="/org/settings">
          <Button variant="outline">
            <Settings className="w-4 h-4 mr-1.5" /> Org Settings
          </Button>
        </Link>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4 border-l-4 border-l-amber-500">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Total Workforce</span>
            <Users className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-extrabold text-slate-900 mt-2">
            {data.headcount ?? 0}
          </div>
        </Card>

        <Card className="p-4 border-l-4 border-l-blue-600">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">HR Administrators</span>
            <UserCheck className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-2xl font-extrabold text-blue-600 mt-2">
            {data.activeHrAdmins ?? 0}
          </div>
        </Card>

        <Card className="p-4 border-l-4 border-l-rose-500">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">On Leave Today</span>
            <Clock className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-2xl font-extrabold text-rose-600 mt-2">
            {data.onLeaveToday?.leave ?? 0}
          </div>
        </Card>

        <Card className="p-4 border-l-4 border-l-purple-500">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Pending Approvals</span>
            <Shield className="w-4 h-4 text-purple-500" />
          </div>
          <div className="text-2xl font-extrabold text-purple-600 mt-2">
            {(data.pendingApprovalsCount ?? 0) + (data.pendingHrAdminApprovals ?? 0)}
          </div>
        </Card>
      </div>

      {/* Owner Fast Shortcuts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Organization Governance</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Link
            to="/org/settings"
            className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-100/70 transition-all text-xs font-semibold text-slate-800"
          >
            <Settings className="w-5 h-5 text-amber-600 mb-2" />
            <div className="text-sm">Configure Org Settings</div>
            <p className="text-[11px] text-slate-400 font-normal mt-0.5">
              Working days, timezone, and backdate allowances
            </p>
          </Link>

          <Link
            to="/hr/approvals"
            className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-100/70 transition-all text-xs font-semibold text-slate-800"
          >
            <Shield className="w-5 h-5 text-blue-600 mb-2" />
            <div className="text-sm">HR Approvals Inbox</div>
            <p className="text-[11px] text-slate-400 font-normal mt-0.5">
              Approve leaves for HR admins and managers
            </p>
          </Link>

          <Link
            to="/org/transfer-ownership"
            className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-rose-50 hover:border-rose-200 transition-all text-xs font-semibold text-slate-800"
          >
            <Users className="w-5 h-5 text-rose-600 mb-2" />
            <div className="text-sm">Transfer Ownership</div>
            <p className="text-[11px] text-slate-400 font-normal mt-0.5">
              Hand over primary ownership of this organization
            </p>
          </Link>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Recent Organization Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {(data.recentAudit ?? []).length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No recent audit activity.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {(data.recentAudit ?? []).map((entry) => (
                <div key={entry.id} className="py-3 flex items-center justify-between gap-4 text-xs">
                  <div className="min-w-0">
                    <span className="font-semibold text-slate-800 block">{entry.action || 'Organization activity'}</span>
                    <span className="text-slate-400">
                      {entry.actorName || 'System'}{entry.targetName ? ` · ${entry.targetName}` : ''}
                    </span>
                  </div>
                  <span className="shrink-0 text-slate-400">
                    {entry.createdAt ? formatCalendarDate(entry.createdAt) : 'Date unavailable'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
