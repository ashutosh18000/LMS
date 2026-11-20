import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api-client';
import type { Holiday } from '../../types/api';
import { formatCalendarDate } from '../../lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { SunMedium, Calendar, AlertCircle } from 'lucide-react';

export const HolidaysPage: React.FC = () => {
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());

  const { data: holidays = [], isLoading, error } = useQuery<Holiday[]>({
    queryKey: ['holidays', selectedYear],
    queryFn: () => apiRequest<Holiday[]>(`/holidays?year=${selectedYear}`),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Official Holidays</h1>
          <p className="text-xs text-slate-500 mt-1">Organization declared holidays & calendar offs</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-600">Year:</label>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value={2025}>2025</option>
            <option value={2026}>2026</option>
            <option value={2027}>2027</option>
          </select>
        </div>
      </div>

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Failed to load holidays for year {selectedYear}.</span>
        </div>
      )}

      {!isLoading && holidays.length === 0 && (
        <Card className="text-center py-12 text-slate-400 text-xs">
          No official holidays scheduled for {selectedYear}.
        </Card>
      )}

      {holidays.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {holidays.map((h) => (
            <Card key={h.id} className="hover:shadow-sm transition-all border-l-4 border-l-orange-500">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <h4 className="font-semibold text-slate-800 text-sm">{h.name}</h4>
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
                    <Calendar className="w-3.5 h-3.5 text-orange-500" />
                    <span>{formatCalendarDate(h.date)}</span>
                  </div>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200">
                  Holiday
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
