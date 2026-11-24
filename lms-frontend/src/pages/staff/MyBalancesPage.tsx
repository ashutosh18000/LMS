import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api-client';
import type { MyBalancesResponse } from '../../types/api';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { PieChart, AlertCircle } from 'lucide-react';

export const MyBalancesPage: React.FC = () => {
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());

  const { data, isLoading, error } = useQuery<MyBalancesResponse>({
    queryKey: ['my-balances', selectedYear],
    queryFn: () => apiRequest<MyBalancesResponse>(`/me/balances?year=${selectedYear}`),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">My Leave Balances</h1>
          <p className="text-xs text-slate-500 mt-1">Detailed quota, usage, and monthly limits</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-600">Financial Year:</label>
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-44 rounded-xl" />
          <Skeleton className="h-44 rounded-xl" />
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Failed to load balances for year {selectedYear}.</span>
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {(data.items ?? []).map((b) => (
            <Card key={b.leaveTypeId} className="overflow-hidden">
              <CardHeader className="bg-slate-50/50 border-b border-slate-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <PieChart className="w-4 h-4 text-blue-600" />
                    <CardTitle className="text-sm font-bold text-slate-800">
                      {b.leaveTypeName || 'Leave type'}
                    </CardTitle>
                  </div>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      b.isWfh
                        ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                        : 'bg-blue-50 text-blue-700 border-blue-200'
                    }`}
                  >
                    {b.isWfh ? 'Work From Home' : b.deductsBalance ? 'Balance Deducted' : 'No annual balance'}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="pt-5">
                <div className="grid grid-cols-4 gap-2 text-center pb-4 border-b border-slate-100">
                  <div>
                    <span className="block text-[10px] uppercase text-slate-400 font-medium">Allocated</span>
                    <span className="text-base font-bold text-slate-900">{b.allocated ?? '—'}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase text-slate-400 font-medium">Used</span>
                    <span className="text-base font-bold text-slate-900">{b.used ?? '—'}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase text-slate-400 font-medium">Pending</span>
                    <span className="text-base font-bold text-amber-600">{b.pending ?? '—'}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase text-slate-400 font-medium">Available</span>
                    <span className="text-lg font-extrabold text-blue-600">{b.available ?? '—'}</span>
                  </div>
                </div>
                {b.monthlyLimit != null && (
                  <div className="mt-4 flex justify-between text-xs">
                    <span className="text-slate-500">Monthly usage</span>
                    <span className="font-semibold text-slate-700">
                      {b.usedThisMonth ?? 0} / {b.monthlyLimit}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
