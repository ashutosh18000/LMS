import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiRequest, getFriendlyErrorMessage } from '../../lib/api-client';
import { safeArray } from '../../lib/safe-data';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Play, Eye, AlertCircle, CheckCircle2 } from 'lucide-react';

export const CarryForwardPage: React.FC = () => {
  const currentYear = new Date().getFullYear();
  const [fromYear, setFromYear] = useState<number>(currentYear - 1);
  const [toYear, setToYear] = useState<number>(currentYear);

  const [previewItems, setPreviewItems] = useState<any[] | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; message: string } | null>(null);

  const previewMutation = useMutation({
    mutationFn: (body: any) =>
      apiRequest('/balances/carry-forward/preview', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (data: any) => {
      setPreviewItems(safeArray(data?.items ?? data, 'carryForwardPreview'));
      setFeedback(null);
    },
    onError: (err) => setFeedback({ type: 'error', message: getFriendlyErrorMessage(err) }),
  });

  const runMutation = useMutation({
    mutationFn: (body: any) =>
      apiRequest('/balances/carry-forward/run', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (data: any) => {
      setFeedback({
        type: 'success',
        message: `Carry-forward completed! Processed ${data?.processedCount ?? 'all'} employee records.`,
      });
      setPreviewItems(null);
    },
    onError: (err) => setFeedback({ type: 'error', message: getFriendlyErrorMessage(err) }),
  });

  const handlePreview = () => {
    previewMutation.mutate({ fromYear, toYear });
  };

  const handleRun = () => {
    runMutation.mutate({ fromYear, toYear });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Year-End Carry Forward</h1>
        <p className="text-xs text-slate-500 mt-1">
          Rollover unused leave balances from previous financial year subject to policy caps
        </p>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center justify-between ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
            <span>{feedback.message}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="text-xs font-bold px-1">&times;</button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Carry Forward Parameters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">From Financial Year</label>
              <input
                type="number"
                value={fromYear}
                onChange={(e) => setFromYear(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">To Financial Year</label>
              <input
                type="number"
                value={toYear}
                onChange={(e) => setToYear(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button
              variant="outline"
              onClick={handlePreview}
              isLoading={previewMutation.isPending}
            >
              <Eye className="w-4 h-4 mr-1.5" /> Preview Rollover
            </Button>
            <Button
              onClick={handleRun}
              isLoading={runMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Play className="w-4 h-4 mr-1.5" /> Execute Carry Forward
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Preview Table */}
      {previewItems && (
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="text-sm">Preview Results ({previewItems.length} records)</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-700">
                <tr>
                  <th className="p-3">Employee</th>
                  <th className="p-3">Leave Type</th>
                  <th className="p-3">Unused Balance</th>
                  <th className="p-3">Max Cap</th>
                  <th className="p-3">Carried Forward</th>
                  <th className="p-3">Lapsed / Expired</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {previewItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-6 text-slate-400">
                      No eligible carry-forward records found for {fromYear} &rarr; {toYear}.
                    </td>
                  </tr>
                ) : (
                  previewItems.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50">
                      <td className="p-3 font-semibold text-slate-900">{item.name || item.userName || item.userId}</td>
                      <td className="p-3 text-slate-700">{item.typeName || item.leaveTypeName || item.leaveTypeId}</td>
                      <td className="p-3 text-slate-600 font-medium">{item.available ?? item.unusedDays ?? '0'}</td>
                      <td className="p-3 text-slate-600">{item.carryForwardMax ?? '0'}</td>
                      <td className="p-3 font-bold text-emerald-600">+{item.carry ?? item.carriedDays ?? '0'}</td>
                      <td className="p-3 font-medium text-rose-500">
                        {item.skippedReason ||
                          (Number(item.available || 0) > Number(item.carry || 0)
                            ? (Number(item.available || 0) - Number(item.carry || 0)).toFixed(1)
                            : '0')}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
};
