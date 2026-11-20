import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api-client';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { Download, FileSpreadsheet, AlertCircle } from 'lucide-react';

export const ReportsPage: React.FC = () => {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(currentYear);
  const [activeTab, setActiveTab] = useState<'balance-summary' | 'utilization'>('balance-summary');
  const [isExporting, setIsExporting] = useState(false);

  const { data: balanceData, isLoading: isLoadingBal } = useQuery<any[]>({
    queryKey: ['reports-balance-summary', year],
    queryFn: () => apiRequest<any[]>(`/reports/balance-summary?year=${year}`),
  });

  const { data: utilData, isLoading: isLoadingUtil } = useQuery<any[]>({
    queryKey: ['reports-utilization', year],
    queryFn: () => apiRequest<any[]>(`/reports/utilization?year=${year}`),
  });

  const handleExportCsv = async () => {
    setIsExporting(true);
    try {
      const blob = await apiRequest<Blob>(`/reports/leaves/export?year=${year}`);
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `leave-report-${year}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch {
      alert('Failed to download CSV report.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Workforce Leave Reports</h1>
          <p className="text-xs text-slate-500 mt-1">Audit balance quotas, utilization analytics and CSV export</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-semibold bg-white"
          >
            <option value={2025}>2025</option>
            <option value={2026}>2026</option>
            <option value={2027}>2027</option>
          </select>
          <Button onClick={handleExportCsv} isLoading={isExporting}>
            <Download className="w-4 h-4 mr-1.5" /> Export CSV
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 gap-6 text-xs font-semibold">
        <button
          onClick={() => setActiveTab('balance-summary')}
          className={`pb-3 border-b-2 transition-colors ${
            activeTab === 'balance-summary'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          Workforce Balance Summary
        </button>
        <button
          onClick={() => setActiveTab('utilization')}
          className={`pb-3 border-b-2 transition-colors ${
            activeTab === 'utilization'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          Utilization Metrics
        </button>
      </div>

      {/* Balance Summary Tab Content */}
      {activeTab === 'balance-summary' && (
        <>
          {isLoadingBal ? (
            <Skeleton className="h-64 rounded-2xl" />
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-semibold">
                    <tr>
                      <th className="p-3">Employee</th>
                      <th className="p-3">Leave Type</th>
                      <th className="p-3">Allocated</th>
                      <th className="p-3">Used</th>
                      <th className="p-3">Pending</th>
                      <th className="p-3">Available</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {!balanceData || balanceData.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-8 text-slate-400">
                          No balance summary records for {year}.
                        </td>
                      </tr>
                    ) : (
                      balanceData.map((row: any, i: number) => (
                        <tr key={i} className="hover:bg-slate-50/50">
                          <td className="p-3 font-semibold text-slate-900">{row.userName || row.name}</td>
                          <td className="p-3 text-slate-700">{row.leaveTypeName || row.typeName}</td>
                          <td className="p-3 font-medium text-slate-600">{row.allocated}</td>
                          <td className="p-3 font-medium text-slate-600">{row.used}</td>
                          <td className="p-3 font-medium text-amber-600">{row.pending}</td>
                          <td className="p-3 font-bold text-blue-600">{row.available}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {/* Utilization Tab Content */}
      {activeTab === 'utilization' && (
        <>
          {isLoadingUtil ? (
            <Skeleton className="h-64 rounded-2xl" />
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-semibold">
                    <tr>
                      <th className="p-3">Leave Policy</th>
                      <th className="p-3">Total Allocated Days</th>
                      <th className="p-3">Total Used Days</th>
                      <th className="p-3">Utilization Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {!utilData || utilData.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="text-center py-8 text-slate-400">
                          No utilization data found for {year}.
                        </td>
                      </tr>
                    ) : (
                      utilData.map((row: any, i: number) => (
                        <tr key={i} className="hover:bg-slate-50/50">
                          <td className="p-3 font-semibold text-slate-900">{row.leaveTypeName || row.name}</td>
                          <td className="p-3 font-medium text-slate-700">{row.totalAllocated}</td>
                          <td className="p-3 font-medium text-slate-700">{row.totalUsed}</td>
                          <td className="p-3 font-bold text-blue-600">{row.utilizationPercentage ?? '0%'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
};
