import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api-client';
import type { RangeAvailabilityResponse, TodayAvailabilityResponse } from '../../types/api';
import { formatCalendarDate } from '../../lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { Calendar, Users, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';

export const TeamAvailabilityCalendarPage: React.FC = () => {
  // Setup 14-day window starting from today
  const getInitialDates = () => {
    const start = new Date();
    start.setDate(start.getDate() - 2); // 2 days ago
    const end = new Date(start);
    end.setDate(end.getDate() + 13); // 14 days range

    const fmt = (d: Date) => d.toISOString().split('T')[0];
    return { from: fmt(start), to: fmt(end) };
  };

  const [dateRange, setDateRange] = useState(getInitialDates());

  const { data, isLoading, error } = useQuery<RangeAvailabilityResponse>({
    queryKey: ['team-availability-range', dateRange.from, dateRange.to],
    queryFn: () =>
      apiRequest<RangeAvailabilityResponse>('/team/availability', {
        params: { from: dateRange.from, to: dateRange.to },
      }),
  });

  // Generate date array for headers
  const getDatesBetween = (from: string, to: string) => {
    const list: string[] = [];
    const cur = new Date(from);
    const last = new Date(to);
    while (cur <= last) {
      list.push(cur.toISOString().split('T')[0]);
      cur.setDate(cur.getDate() + 1);
    }
    return list;
  };

  const datesList = getDatesBetween(dateRange.from, dateRange.to);

  const getCellDisplay = (dayInfo?: { status: string; portion?: string | null; offReason?: string | null; holidayName?: string | null }) => {
    if (!dayInfo) return <span className="text-slate-300">—</span>;

    if (dayInfo.status === 'on_leave') {
      return (
        <span
          title={`On Leave${dayInfo.portion && dayInfo.portion !== 'full' ? ` (${dayInfo.portion})` : ''}`}
          className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800"
        >
          {dayInfo.portion === 'first_half' ? 'L½' : dayInfo.portion === 'second_half' ? '½L' : 'L'}
        </span>
      );
    }

    if (dayInfo.status === 'wfh') {
      return (
        <span
          title={`Work From Home${dayInfo.portion && dayInfo.portion !== 'full' ? ` (${dayInfo.portion})` : ''}`}
          className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800"
        >
          {dayInfo.portion && dayInfo.portion !== 'full' ? 'W½' : 'WFH'}
        </span>
      );
    }

    if (dayInfo.status === 'off') {
      const isHol = dayInfo.offReason === 'holiday';
      return (
        <span
          title={isHol ? `Holiday: ${dayInfo.holidayName || ''}` : 'Weekly Off'}
          className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
            isHol ? 'bg-orange-100 text-orange-800' : 'bg-slate-200 text-slate-600'
          }`}
        >
          {isHol ? 'H' : 'Off'}
        </span>
      );
    }

    return (
      <span title="Available" className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" />
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Team Availability Matrix</h1>
          <p className="text-xs text-slate-500 mt-1">
            Real-time schedule resolution, weekly offs, holidays, approved leave & WFH
          </p>
        </div>

        {/* Date Controls */}
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateRange.from}
            onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
          />
          <span className="text-xs text-slate-400">to</span>
          <input
            type="date"
            value={dateRange.to}
            onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
          />
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 p-3 rounded-xl bg-white border border-slate-200 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
          <span className="text-slate-600">Available</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">L</span>
          <span className="text-slate-600">On Leave</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800">WFH</span>
          <span className="text-slate-600">Work From Home</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-100 text-orange-800">H</span>
          <span className="text-slate-600">Holiday</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-600">Off</span>
          <span className="text-slate-600">Weekly Off (Sat/Sun)</span>
        </div>
      </div>

      {isLoading && <Skeleton className="h-96 rounded-2xl" />}

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Failed to load team availability matrix.</span>
        </div>
      )}

      {data && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="p-3 font-semibold text-slate-800 sticky left-0 bg-slate-50 min-w-[160px] z-10">
                    Team Member
                  </th>
                  {datesList.map((d) => {
                    const dt = new Date(d);
                    const dayName = dt.toLocaleDateString('en-US', { weekday: 'narrow' });
                    const dayNum = d.split('-')[2];

                    return (
                      <th key={d} className="p-2 text-center font-semibold text-slate-700 min-w-[50px]">
                        <span className="block text-[10px] text-slate-400 font-bold">{dayName}</span>
                        <span>{dayNum}</span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.members.map((member) => (
                  <tr key={member.userId} className="hover:bg-slate-50/70 transition-colors">
                    <td className="p-3 font-medium text-slate-800 sticky left-0 bg-white z-10 border-r border-slate-100 shadow-sm">
                      <div className="font-semibold text-slate-900">{member.userName}</div>
                      <div className="text-[10px] text-slate-400">{member.department || 'General'}</div>
                    </td>
                    {datesList.map((d) => (
                      <td key={d} className="p-2 text-center">
                        {getCellDisplay(member.days[d])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
};
