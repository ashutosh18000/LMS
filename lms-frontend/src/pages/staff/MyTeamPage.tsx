import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api-client';
import { safeArray } from '../../lib/safe-data';
import type { TodayAvailabilityResponse } from '../../types/api';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { formatCalendarDate } from '../../lib/utils';
import { CheckCircle2, Home, SunMedium, AlertCircle, Clock } from 'lucide-react';

export const MyTeamPage: React.FC = () => {
  const { data, isLoading, error } = useQuery<TodayAvailabilityResponse>({
    queryKey: ['my-team-today'],
    queryFn: () => apiRequest<TodayAvailabilityResponse>('/my-team/availability/today'),
  });

  const getStatusBadge = (
    status: TodayAvailabilityResponse['members'][number]['status'] | null | undefined,
    portion?: string | null,
  ) => {
    switch (status) {
      case 'available':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3" /> Available
          </span>
        );
      case 'leave':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
            <Clock className="w-3 h-3" /> On Leave{portion && portion !== 'full' ? ` (${(portion ?? '').replace('_', ' ')})` : ''}
          </span>
        );
      case 'wfh':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
            <Home className="w-3 h-3" /> WFH{portion && portion !== 'full' ? ` (${(portion ?? '').replace('_', ' ')})` : ''}
          </span>
        );
      case 'off':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
            <SunMedium className="w-3 h-3 text-orange-500" />
            Weekly Off
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">My Team Status Today</h1>
        <p className="text-xs text-slate-500 mt-1">
          Peer availability overview for {formatCalendarDate(data?.date || new Date().toISOString().split('T')[0])}
        </p>
      </div>

      {isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Failed to load team availability.</span>
        </div>
      )}

      {data && (
        <div className="space-y-6">
          {data.dayInfo?.isHoliday && (
            <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
              Holiday{data.dayInfo.holidayName ? `: ${data.dayInfo.holidayName}` : ''}
            </div>
          )}
          {/* Quick Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <Card className="text-center p-3">
              <span className="block text-[10px] uppercase font-semibold text-slate-400">Total Members</span>
              <span className="text-xl font-extrabold text-slate-900">{data.counts.total}</span>
            </Card>
            <Card className="text-center p-3">
              <span className="block text-[10px] uppercase font-semibold text-slate-400">Available</span>
              <span className="text-xl font-extrabold text-emerald-600">{data.counts.available}</span>
            </Card>
            <Card className="text-center p-3">
              <span className="block text-[10px] uppercase font-semibold text-slate-400">On Leave</span>
              <span className="text-xl font-extrabold text-rose-600">{data.counts.onLeave}</span>
            </Card>
            <Card className="text-center p-3">
              <span className="block text-[10px] uppercase font-semibold text-slate-400">WFH</span>
              <span className="text-xl font-extrabold text-indigo-600">{data.counts.wfh}</span>
            </Card>
            <Card className="text-center p-3">
              <span className="block text-[10px] uppercase font-semibold text-slate-400">Off (Sat/Sun/Hol)</span>
              <span className="text-xl font-extrabold text-slate-600">{data.counts.off}</span>
            </Card>
          </div>

          {/* Members List */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Team Members Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="divide-y divide-slate-100">
                {safeArray(data?.members, 'myTeamMembers').map((m) => (
                  <div key={m.userId} className="py-3 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 font-semibold text-xs flex items-center justify-center uppercase">
                        {(m.name ?? '?').slice(0, 2)}
                      </div>
                      <div>
                        <span className="font-semibold text-slate-800 text-sm block">{m.name ?? 'Team member'}</span>
                        <span className="text-[11px] text-slate-400">
                          {m.department ?? 'General'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {m.halfDay && (
                        <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                          Half day
                        </span>
                      )}
                      {getStatusBadge(m.status, m.portion)}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};
