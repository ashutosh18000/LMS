import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiRequest } from '../../lib/api-client';
import type { DashboardMeResponse } from '../../types/api';
import { formatCalendarDate, statusBadgeColor } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { Calendar, Clock, Plus, Zap, AlertCircle } from 'lucide-react';

export const StaffDashboardPage: React.FC = () => {
  const { data, isLoading, error } = useQuery<DashboardMeResponse>({
    queryKey: ['dashboard-me'],
    queryFn: () => apiRequest<DashboardMeResponse>('/dashboard/me'),
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 flex items-center gap-3">
        <AlertCircle className="w-5 h-5 shrink-0" />
        <div>Failed to load dashboard data. Please try refreshing.</div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Welcome back, {data.user.name} 👋
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Financial Year {data.year} &bull; {data.user.department || 'General'}
          </p>
        </div>
        <Link to="/apply-leave">
          <Button className="w-full sm:w-auto shadow-sm shadow-blue-500/20">
            <Plus className="w-4 h-4 mr-1.5" /> Apply Leave / WFH
          </Button>
        </Link>
      </div>

      {/* Balance Cards Grid */}
      <section>
        <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wider mb-3">
          Your Leave Balances
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.balances.map((b) => (
            <Card key={b.leaveTypeId} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold text-slate-800">
                    {b.name}
                  </CardTitle>
                  {b.isWfh ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                      WFH
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                      Leave
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {b.isWfh ? (
                  <div className="pt-2">
                    <div className="text-2xl font-bold text-slate-900">
                      {b.monthlyLimit ? `${b.monthlyLimit - (b.usedThisMonth || 0)} left` : 'Unlimited'}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Used this month: <span className="font-semibold text-slate-700">{b.usedThisMonth || 0}</span> days
                    </p>
                  </div>
                ) : (
                  <div className="pt-2">
                    <div className="text-3xl font-extrabold text-slate-900 tracking-tight">
                      {b.available}
                      <span className="text-xs font-normal text-slate-400 ml-1.5">days available</span>
                    </div>
                    <div className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-3 text-center text-xs text-slate-500">
                      <div>
                        <span className="block text-[10px] uppercase text-slate-400">Allocated</span>
                        <span className="font-semibold text-slate-700">{b.allocated}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] uppercase text-slate-400">Used</span>
                        <span className="font-semibold text-slate-700">{b.used}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] uppercase text-slate-400">Pending</span>
                        <span className="font-semibold text-amber-600">{b.pending}</span>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Requests & Upcoming Leaves Split */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending Requests */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-500" />
                <CardTitle className="text-sm">Pending Approval</CardTitle>
              </div>
              <Link to="/my-requests" className="text-xs text-blue-600 hover:underline">
                View all
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {data.pendingRequests.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                No pending leave requests at this time.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {data.pendingRequests.map((req) => (
                  <div key={req.id} className="py-3 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-medium text-slate-800">
                        {req.segments[0]
                          ? `${formatCalendarDate(req.segments[0].startDate)} - ${formatCalendarDate(req.segments[0].endDate)}`
                          : 'Leave'}
                      </div>
                      <p className="text-slate-400 text-[11px] mt-0.5">{req.reason}</p>
                    </div>
                    <div className="text-right">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${statusBadgeColor(req.status)}`}>
                        {req.status}
                      </span>
                      <span className="block text-[11px] font-medium text-slate-500 mt-1">
                        {req.countedDays} days
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Upcoming Approved Leaves */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-emerald-500" />
                <CardTitle className="text-sm">Upcoming Approved Leave</CardTitle>
              </div>
              <Link to="/my-requests" className="text-xs text-blue-600 hover:underline">
                History
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {data.upcomingLeaves.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                No upcoming leaves scheduled.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {data.upcomingLeaves.map((req) => (
                  <div key={req.id} className="py-3 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-medium text-slate-800">
                        {req.segments[0]
                          ? `${formatCalendarDate(req.segments[0].startDate)} - ${formatCalendarDate(req.segments[0].endDate)}`
                          : 'Approved Leave'}
                      </div>
                      <p className="text-slate-400 text-[11px] mt-0.5">{req.reason}</p>
                    </div>
                    <div className="text-right">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${statusBadgeColor(req.status)}`}>
                        {req.status}
                      </span>
                      <span className="block text-[11px] font-medium text-slate-500 mt-1">
                        {req.countedDays} days
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
