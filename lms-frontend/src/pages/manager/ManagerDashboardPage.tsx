import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiRequest } from '../../lib/api-client';
import type { DashboardTeamResponse } from '../../types/api';
import { formatCalendarDate } from '../../lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { Button } from '../../components/ui/button';
import { Users, Calendar, CheckCircle2, Home, Clock, SunMedium, AlertCircle } from 'lucide-react';

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
            Team roster oversight &bull; {data.teamSize} direct reports
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
          <div className="text-2xl font-extrabold text-slate-900 mt-2">{data.teamSize}</div>
        </Card>

        <Card className="p-4 border-l-4 border-l-emerald-500">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Available Today</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-extrabold text-emerald-600 mt-2">
            {data.today.counts.available}
          </div>
        </Card>

        <Card className="p-4 border-l-4 border-l-rose-500">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">On Leave Today</span>
            <Clock className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-2xl font-extrabold text-rose-600 mt-2">
            {data.today.counts.onLeave}
          </div>
        </Card>

        <Card className="p-4 border-l-4 border-l-indigo-500">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">WFH Today</span>
            <Home className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-extrabold text-indigo-600 mt-2">
            {data.today.counts.wfh}
          </div>
        </Card>
      </div>

      {/* Today's Roster Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Today's Team Roster ({formatCalendarDate(data.today.date)})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-slate-100">
            {data.today.members.map((m) => (
              <div key={m.userId} className="py-3 flex items-center justify-between text-xs">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-700 font-bold text-xs flex items-center justify-center uppercase">
                    {m.userName.slice(0, 2)}
                  </div>
                  <div>
                    <span className="font-semibold text-slate-800 text-sm block">{m.userName}</span>
                    <span className="text-[11px] text-slate-400 capitalize">{m.role}</span>
                  </div>
                </div>

                <div>
                  {m.status === 'available' && (
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      Available
                    </span>
                  )}
                  {m.status === 'on_leave' && (
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                      On Leave {m.portion && m.portion !== 'full' ? `(${m.portion})` : ''}
                    </span>
                  )}
                  {m.status === 'wfh' && (
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                      WFH {m.portion && m.portion !== 'full' ? `(${m.portion})` : ''}
                    </span>
                  )}
                  {m.status === 'off' && (
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                      {m.offReason === 'holiday' ? `Holiday: ${m.holidayName}` : 'Weekly Off'}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
