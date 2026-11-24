import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiRequest } from '../../lib/api-client';
import type { DashboardTeamResponse } from '../../types/api';
import { formatCalendarDate } from '../../lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { Button } from '../../components/ui/button';
import { Users, Calendar, CheckCircle2, Home, Clock, AlertCircle } from 'lucide-react';

export const ManagerDashboardPage: React.FC = () => {
  const { data, isLoading, error } = useQuery<DashboardTeamResponse>({
    queryKey: ['dashboard-team'],
    queryFn: () => apiRequest<DashboardTeamResponse>('/dashboard/team'),
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
        <span>Failed to load manager dashboard.</span>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Manager Dashboard</h1>
          <p className="text-xs text-slate-500 mt-1">
            Team roster oversight &bull; {data.today?.total ?? 0} direct reports
          </p>
        </div>
        <Link to="/team/availability">
          <Button variant="outline">
            <Calendar className="w-4 h-4 mr-1.5" /> Full Availability Calendar
          </Button>
        </Link>
      </div>

      {/* Team Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4 border-l-4 border-l-blue-500">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Team Size</span>
            <Users className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-2xl font-extrabold text-slate-900 mt-2">{data.today?.total ?? 0}</div>
        </Card>

        <Card className="p-4 border-l-4 border-l-emerald-500">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Available Today</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-extrabold text-emerald-600 mt-2">
            {data.today?.available ?? 0}
          </div>
        </Card>

        <Card className="p-4 border-l-4 border-l-rose-500">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">On Leave Today</span>
            <Clock className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-2xl font-extrabold text-rose-600 mt-2">
            {data.today?.onLeave ?? 0}
          </div>
        </Card>

        <Card className="p-4 border-l-4 border-l-indigo-500">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">WFH Today</span>
            <Home className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-extrabold text-indigo-600 mt-2">
            {data.today?.wfh ?? 0}
          </div>
        </Card>
      </div>

      {/* Upcoming team leave and WFH */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Upcoming Team Leave &amp; WFH</CardTitle>
        </CardHeader>
        <CardContent>
          {(data.upcoming ?? []).length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-400">No upcoming team leave or WFH.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {(data.upcoming ?? []).map((item, index) => (
                <div key={`${item.member?.id ?? 'member'}-${item.startDate}-${index}`} className="py-3 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-semibold text-slate-800 block">{item.member?.name || 'Team member'}</span>
                    <span className="text-[11px] text-slate-400">{item.member?.department || 'General'}</span>
                  </div>
                  <div className="text-right">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${item.kind === 'wfh' ? 'bg-indigo-50 text-indigo-700' : 'bg-rose-50 text-rose-700'}`}>
                      {item.kind === 'wfh' ? 'WFH' : 'On Leave'}
                    </span>
                    <span className="block text-[11px] text-slate-500 mt-1">
                      {item.startDate && item.endDate
                        ? `${formatCalendarDate(item.startDate)} - ${formatCalendarDate(item.endDate)}`
                        : 'Dates unavailable'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
