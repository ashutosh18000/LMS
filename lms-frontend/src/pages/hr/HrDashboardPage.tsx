import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiRequest } from '../../lib/api-client';
import type { DashboardHrResponse } from '../../types/api';
import { formatCalendarDate } from '../../lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { Button } from '../../components/ui/button';
import { Users, FileCheck, Clock, Home, UserCheck, AlertCircle } from 'lucide-react';

export const HrDashboardPage: React.FC = () => {
  const { data, isLoading, error } = useQuery<DashboardHrResponse>({
    queryKey: ['dashboard-hr'],
    queryFn: () => apiRequest<DashboardHrResponse>('/dashboard/hr'),
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
        <span>Failed to load HR dashboard metrics.</span>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">HR Administration Dashboard</h1>
          <p className="text-xs text-slate-500 mt-1">
            Workforce leave tracking, policy compliance & approvals inbox
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/hr/on-behalf">
            <Button size="sm" variant="outline">
              <UserCheck className="w-4 h-4 mr-1.5 text-blue-600" /> Apply On-Behalf
            </Button>
          </Link>
          <Link to="/hr/approvals">
            <Button size="sm">
              <FileCheck className="w-4 h-4 mr-1.5" /> Approvals ({data.pendingApprovalsCount ?? 0})
            </Button>
          </Link>
        </div>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4 border-l-4 border-l-blue-600">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Total Workforce</span>
            <Users className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-2xl font-extrabold text-slate-900 mt-2">{data.headcount ?? 0}</div>
        </Card>

        <Card className="p-4 border-l-4 border-l-amber-500">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Pending Approvals</span>
            <FileCheck className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-extrabold text-amber-600 mt-2">
            {data.pendingApprovalsCount ?? 0}
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

        <Card className="p-4 border-l-4 border-l-indigo-500">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">WFH Today</span>
            <Home className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-extrabold text-indigo-600 mt-2">
            {data.onLeaveToday?.wfh ?? 0}
          </div>
        </Card>
      </div>

      {/* Monthly breakdown and upcoming holidays */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm">This Month by Leave Type</CardTitle>
            <Link to="/hr/approvals" className="text-xs text-blue-600 hover:underline">
              Review approvals
            </Link>
          </CardHeader>
          <CardContent>
            {(data.thisMonth?.byLeaveType ?? []).length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">No approved leave this month.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {(data.thisMonth?.byLeaveType ?? []).map((item) => (
                  <div key={item.name} className="py-3 flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-800">{item.name || 'Leave type'}</span>
                    <span className="font-semibold text-slate-600">{item.days ?? 0} days</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick HR Setup Shortcuts */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Department Breakdown &amp; Upcoming Holidays</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              {(data.thisMonth?.byDepartment ?? []).map((item) => (
                <div key={item.department} className="flex items-center justify-between text-xs">
                  <span className="text-slate-600">{item.department || 'Unassigned'}</span>
                  <span className="font-semibold text-slate-700">{item.days ?? 0} days</span>
                </div>
              ))}
            </div>
            <div className="border-t border-slate-100 pt-3">
              <h3 className="text-xs font-semibold text-slate-700 mb-2">Upcoming Holidays</h3>
              {(data.upcomingHolidays ?? []).length === 0 ? (
                <p className="text-xs text-slate-400">No upcoming holidays.</p>
              ) : (data.upcomingHolidays ?? []).map((holiday) => (
                <div key={holiday.id} className="flex justify-between text-xs py-1">
                  <span className="text-slate-600">{holiday.name || 'Holiday'}</span>
                  <span className="text-slate-400">{holiday.date ? formatCalendarDate(holiday.date) : 'Date unavailable'}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-slate-100 pt-3 flex flex-wrap gap-3 text-[11px] text-slate-500">
              <span>Last 30 days:</span>
              <span>Pending {data.requestsLast30Days?.pending ?? 0}</span>
              <span>Approved {data.requestsLast30Days?.approved ?? 0}</span>
              <span>Rejected {data.requestsLast30Days?.rejected ?? 0}</span>
            </div>
            <Link
              to="/hr/users"
              className="flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-slate-100/70 transition-colors text-xs font-semibold text-slate-800"
            >
              <span>Employee Directory & Management</span>
              <span className="text-slate-400">&rarr;</span>
            </Link>
            <Link
              to="/hr/leave-types"
              className="flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-slate-100/70 transition-colors text-xs font-semibold text-slate-800"
            >
              <span>Leave Types & Quotas</span>
              <span className="text-slate-400">&rarr;</span>
            </Link>
            <Link
              to="/hr/schedules"
              className="flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-slate-100/70 transition-colors text-xs font-semibold text-slate-800"
            >
              <span>Work Schedules & Saturday Modes</span>
              <span className="text-slate-400">&rarr;</span>
            </Link>
            <Link
              to="/hr/balances"
              className="flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-slate-100/70 transition-colors text-xs font-semibold text-slate-800"
            >
              <span>Balance Allocation & Manual Adjustments</span>
              <span className="text-slate-400">&rarr;</span>
            </Link>
            <Link
              to="/hr/reports"
              className="flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-slate-100/70 transition-colors text-xs font-semibold text-slate-800"
            >
              <span>Reports & CSV Export</span>
              <span className="text-slate-400">&rarr;</span>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
