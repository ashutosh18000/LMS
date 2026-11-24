import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api-client';
import { safeArray } from '../../lib/safe-data';
import type {
  BalanceSummaryReportResponse,
  BalanceSummaryRow,
  UtilizationReportResponse,
  UtilizationDepartmentItem,
  UtilizationLeaveTypeItem,
  UtilizationUserItem,
} from '../../types/reports';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { Download, AlertCircle, BarChart3, Users, Calendar } from 'lucide-react';

export const ReportsPage: React.FC = () => {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(currentYear);
  const [activeTab, setActiveTab] = useState<'balance-summary' | 'utilization'>('balance-summary');
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Utilization filters
  const [utilGroupBy, setUtilGroupBy] = useState<'department' | 'leaveType' | 'user'>('department');
  const [fromDate, setFromDate] = useState<string>(`${currentYear}-01-01`);
  const [toDate, setToDate] = useState<string>(`${currentYear}-03-31`);

  // 1. Balance Summary Query
  const {
    data: balanceData,
    isLoading: isLoadingBal,
    error: balError,
  } = useQuery<BalanceSummaryReportResponse>({
    queryKey: ['reports-balance-summary', year],
    queryFn: () => apiRequest<BalanceSummaryReportResponse>(`/reports/balance-summary?year=${year}`),
    enabled: activeTab === 'balance-summary',
  });

  // 2. Utilization Query
  const {
    data: utilData,
    isLoading: isLoadingUtil,
    error: utilError,
  } = useQuery<UtilizationReportResponse>({
    queryKey: ['reports-utilization', fromDate, toDate, utilGroupBy],
    queryFn: () =>
      apiRequest<UtilizationReportResponse>(
        `/reports/utilization?from=${fromDate}&to=${toDate}&groupBy=${utilGroupBy}`,
      ),
    enabled: activeTab === 'utilization',
  });

  // 3. Authenticated CSV Export via apiRequest<Blob>
  const handleExportCsv = async () => {
    setIsExporting(true);
    setExportError(null);
    try {
      let endpoint = '';
      let downloadFilename = '';

      if (activeTab === 'balance-summary') {
        endpoint = `/reports/balance-summary?year=${year}&format=csv`;
        downloadFilename = `balance-summary-report-${year}.csv`;
      } else {
        endpoint = `/reports/utilization?from=${fromDate}&to=${toDate}&groupBy=${utilGroupBy}&format=csv`;
        downloadFilename = `utilization-${utilGroupBy}-${fromDate}-to-${toDate}.csv`;
      }

      // Authenticated fetch: apiRequest handles Authorization header, 401 refresh, and returns Blob
      const blob = await apiRequest<Blob>(endpoint);
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = downloadFilename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err: any) {
      setExportError(err?.message || 'Failed to download CSV report.');
    } finally {
      setIsExporting(false);
    }
  };

  const balanceRows: BalanceSummaryRow[] = safeArray(balanceData?.rows, 'balanceRows');
  const deptTotals = safeArray(balanceData?.totals?.byDepartment, 'deptTotals');
  const typeTotals = safeArray(balanceData?.totals?.byLeaveType, 'typeTotals');
  const utilItems = safeArray(utilData?.items, 'utilItems');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Workforce Leave Reports</h1>
          <p className="text-xs text-slate-500 mt-1">Audit balance quotas, utilization analytics and CSV export</p>
        </div>
        <div className="flex items-center gap-3">
          {activeTab === 'balance-summary' && (
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-semibold bg-white"
            >
              <option value={2025}>2025</option>
              <option value={2026}>2026</option>
              <option value={2027}>2027</option>
            </select>
          )}
          <Button onClick={handleExportCsv} isLoading={isExporting}>
            <Download className="w-4 h-4 mr-1.5" /> Export CSV
          </Button>
        </div>
      </div>

      {exportError && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{exportError}</span>
        </div>
      )}

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
        <div className="space-y-6">
          {balError && (
            <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Failed to load balance summary for {year}.</span>
            </div>
          )}

          {isLoadingBal ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Skeleton className="h-28 rounded-2xl" />
                <Skeleton className="h-28 rounded-2xl" />
              </div>
              <Skeleton className="h-64 rounded-2xl" />
            </div>
          ) : (
            <>
              {/* Summary Cards: Department & Leave Type Totals */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Department Totals Card */}
                <Card>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-900 border-b border-slate-100 pb-2">
                      <Users className="w-4 h-4 text-blue-600" /> Department Breakdown
                    </div>
                    {deptTotals.length === 0 ? (
                      <p className="text-xs text-slate-400 py-2">No department totals available.</p>
                    ) : (
                      <div className="space-y-2 max-h-40 overflow-y-auto pr-1 text-xs">
                        {deptTotals.map((d: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-slate-50">
                            <span className="font-semibold text-slate-800">{d.department || 'Unassigned'}</span>
                            <div className="flex items-center gap-3 text-[11px]">
                              <span className="text-slate-500">Allocated: <strong>{d.allocated}</strong></span>
                              <span className="text-slate-600">Used: <strong>{d.used}</strong></span>
                              <span className="text-blue-600 font-bold">Avail: {d.available}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Leave Type Totals Card */}
                <Card>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-900 border-b border-slate-100 pb-2">
                      <BarChart3 className="w-4 h-4 text-emerald-600" /> Policy Quota Totals
                    </div>
                    {typeTotals.length === 0 ? (
                      <p className="text-xs text-slate-400 py-2">No leave type totals available.</p>
                    ) : (
                      <div className="space-y-2 max-h-40 overflow-y-auto pr-1 text-xs">
                        {typeTotals.map((t: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-slate-50">
                            <span className="font-semibold text-slate-800">{t.leaveTypeName}</span>
                            <div className="flex items-center gap-3 text-[11px]">
                              <span className="text-slate-500">Allocated: <strong>{t.allocated}</strong></span>
                              <span className="text-slate-600">Used: <strong>{t.used}</strong></span>
                              <span className="text-emerald-600 font-bold">Avail: {t.available}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Employee Balance Detail Table */}
              <Card className="overflow-hidden">
                <div className="p-3 bg-slate-50/70 border-b border-slate-100 flex items-center justify-between text-xs font-semibold text-slate-700">
                  <span>Employee Balances ({balanceRows.length} records)</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-semibold">
                      <tr>
                        <th className="p-3">Employee</th>
                        <th className="p-3">Department</th>
                        <th className="p-3">Leave Type</th>
                        <th className="p-3">Allocated</th>
                        <th className="p-3">Used</th>
                        <th className="p-3">Pending</th>
                        <th className="p-3">Available</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {balanceRows.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="text-center py-8 text-slate-400">
                            No balance summary records for {year}.
                          </td>
                        </tr>
                      ) : (
                        balanceRows.map((row: BalanceSummaryRow, i: number) => (
                          <tr key={i} className="hover:bg-slate-50/50">
                            <td className="p-3 font-semibold text-slate-900">{row.userName}</td>
                            <td className="p-3 text-slate-600">{row.department || '—'}</td>
                            <td className="p-3 text-slate-700">{row.leaveTypeName}</td>
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
            </>
          )}
        </div>
      )}

      {/* Utilization Tab Content */}
      {activeTab === 'utilization' && (
        <div className="space-y-4">
          {/* Controls Bar */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap items-center gap-4 text-xs font-semibold text-slate-700">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-500" />
              <span>Date Range (max 92 days):</span>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="px-2 py-1 rounded-lg border border-slate-300 bg-white text-xs"
              />
              <span className="text-slate-400">to</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="px-2 py-1 rounded-lg border border-slate-300 bg-white text-xs"
              />
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <span>Group By:</span>
              <select
                value={utilGroupBy}
                onChange={(e) => setUtilGroupBy(e.target.value as any)}
                className="px-2 py-1 rounded-lg border border-slate-300 bg-white text-xs font-semibold"
              >
                <option value="department">Department</option>
                <option value="leaveType">Leave Type</option>
                <option value="user">User</option>
              </select>
            </div>
          </div>

          {utilError && (
            <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Failed to load utilization report. Please verify date range (max 92 days).</span>
            </div>
          )}

          {isLoadingUtil ? (
            <Skeleton className="h-64 rounded-2xl" />
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-semibold">
                    {utilGroupBy === 'department' && (
                      <tr>
                        <th className="p-3">Department</th>
                        <th className="p-3">Total Approved Days</th>
                        <th className="p-3">Active Headcount</th>
                        <th className="p-3">Per-Employee Average</th>
                      </tr>
                    )}
                    {utilGroupBy === 'leaveType' && (
                      <tr>
                        <th className="p-3">Leave Policy</th>
                        <th className="p-3">Is WFH</th>
                        <th className="p-3">Total Approved Days</th>
                      </tr>
                    )}
                    {utilGroupBy === 'user' && (
                      <tr>
                        <th className="p-3">Employee</th>
                        <th className="p-3">Department</th>
                        <th className="p-3">Total Approved Days</th>
                      </tr>
                    )}
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {utilItems.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="text-center py-8 text-slate-400">
                          No utilization data found for selected period ({fromDate} to {toDate}).
                        </td>
                      </tr>
                    ) : (
                      utilItems.map((row: any, i: number) => (
                        <tr key={i} className="hover:bg-slate-50/50">
                          {utilGroupBy === 'department' && (
                            <>
                              <td className="p-3 font-semibold text-slate-900">
                                {(row as UtilizationDepartmentItem).department || 'Unassigned'}
                              </td>
                              <td className="p-3 font-medium text-slate-700">
                                {(row as UtilizationDepartmentItem).days}
                              </td>
                              <td className="p-3 font-medium text-slate-700">
                                {(row as UtilizationDepartmentItem).headcount}
                              </td>
                              <td className="p-3 font-bold text-blue-600">
                                {(row as UtilizationDepartmentItem).perEmployeeAverage}
                              </td>
                            </>
                          )}
                          {utilGroupBy === 'leaveType' && (
                            <>
                              <td className="p-3 font-semibold text-slate-900">
                                {(row as UtilizationLeaveTypeItem).leaveTypeName}
                              </td>
                              <td className="p-3 text-slate-600">
                                {(row as UtilizationLeaveTypeItem).isWfh ? 'Yes' : 'No'}
                              </td>
                              <td className="p-3 font-bold text-blue-600">
                                {(row as UtilizationLeaveTypeItem).days}
                              </td>
                            </>
                          )}
                          {utilGroupBy === 'user' && (
                            <>
                              <td className="p-3 font-semibold text-slate-900">
                                {(row as UtilizationUserItem).userName}
                              </td>
                              <td className="p-3 text-slate-600">
                                {(row as UtilizationUserItem).department || '—'}
                              </td>
                              <td className="p-3 font-bold text-blue-600">
                                {(row as UtilizationUserItem).days}
                              </td>
                            </>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
};
