import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, getFriendlyErrorMessage } from '../../lib/api-client';
import type { User, LeaveType } from '../../types/api';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Modal } from '../../components/ui/modal';
import { PieChart, Sliders, Play, AlertCircle, CheckCircle2 } from 'lucide-react';

export const BalancesManagementPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [isAdjustOpen, setIsAdjustOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; message: string } | null>(null);

  // Adjustment form state
  const [adjustUserId, setAdjustUserId] = useState('');
  const [adjustLeaveTypeId, setAdjustLeaveTypeId] = useState('');
  const [delta, setDelta] = useState<number>(1);
  const [adjustReason, setAdjustReason] = useState('');

  // Fetch users & leave types for adjustments
  const { data: usersData } = useQuery<{ items: User[] }>({
    queryKey: ['hr-users-all'],
    queryFn: () => apiRequest<{ items: User[] }>('/users?limit=100'),
  });

  const { data: leaveTypes = [] } = useQuery<LeaveType[]>({
    queryKey: ['leave-types-active'],
    queryFn: () => apiRequest<LeaveType[]>('/leave-types'),
  });

  // Bulk Allocate Mutation
  const allocateMutation = useMutation({
    mutationFn: (y: number) =>
      apiRequest('/balances/allocate', { method: 'POST', body: JSON.stringify({ year: y }) }),
    onSuccess: (data: any) => {
      setFeedback({
        type: 'success',
        message: `Balances allocated successfully for ${year}! (Created: ${data?.allocatedCount ?? 'Done'})`,
      });
      queryClient.invalidateQueries({ queryKey: ['my-balances'] });
    },
    onError: (err) => setFeedback({ type: 'error', message: getFriendlyErrorMessage(err) }),
  });

  // Adjust Mutation
  const adjustMutation = useMutation({
    mutationFn: (body: any) =>
      apiRequest('/balances/adjust', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setIsAdjustOpen(false);
      setAdjustReason('');
      setFeedback({ type: 'success', message: 'Balance adjusted successfully and logged to audit trail!' });
      queryClient.invalidateQueries({ queryKey: ['my-balances'] });
    },
    onError: (err) => setFeedback({ type: 'error', message: getFriendlyErrorMessage(err) }),
  });

  const handleAdjustSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustUserId || !adjustLeaveTypeId || !adjustReason.trim()) {
      setFeedback({ type: 'error', message: 'All adjustment fields are required.' });
      return;
    }

    adjustMutation.mutate({
      userId: adjustUserId,
      leaveTypeId: adjustLeaveTypeId,
      year: Number(year),
      delta: Number(delta),
      reason: adjustReason.trim(),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Balances Management</h1>
          <p className="text-xs text-slate-500 mt-1">Bulk annual quota allocation and manual balance corrections</p>
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
          <Button onClick={() => setIsAdjustOpen(true)}>
            <Sliders className="w-4 h-4 mr-1.5" /> Adjust Balance
          </Button>
        </div>
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

      {/* Bulk Allocate Card */}
      <Card className="border-l-4 border-l-blue-600">
        <CardHeader>
          <CardTitle className="text-sm">Bulk Annual Leave Quota Allocation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-slate-600">
            Automatically allocates annual quotas for all active employees for financial year{' '}
            <strong className="text-slate-900">{year}</strong> according to their leave policy definitions.
            This action is idempotent and safe to run multiple times.
          </p>
          <div className="pt-2">
            <Button
              onClick={() => allocateMutation.mutate(year)}
              isLoading={allocateMutation.isPending}
            >
              <Play className="w-4 h-4 mr-1.5" /> Run Quota Allocation for {year}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Adjust Modal */}
      <Modal
        isOpen={isAdjustOpen}
        onClose={() => setIsAdjustOpen(false)}
        title="Manual Balance Adjustment"
        description="Debit or credit leave days with audit justification"
      >
        <form onSubmit={handleAdjustSubmit} className="space-y-4 pt-2">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Employee</label>
            <select
              required
              value={adjustUserId}
              onChange={(e) => setAdjustUserId(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white"
            >
              <option value="">Select an employee</option>
              {usersData?.items?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Leave Type</label>
            <select
              required
              value={adjustLeaveTypeId}
              onChange={(e) => setAdjustLeaveTypeId(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white"
            >
              <option value="">Select leave type</option>
              {leaveTypes.filter((t) => !t.isWfh).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Delta Days (+ or -)</label>
              <input
                type="number"
                step="0.5"
                required
                value={delta}
                onChange={(e) => setDelta(Number(e.target.value))}
                placeholder="+1.0 or -2.0"
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Financial Year</label>
              <input
                type="number"
                required
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Adjustment Reason (Audit Required)
            </label>
            <textarea
              required
              rows={2}
              value={adjustReason}
              onChange={(e) => setAdjustReason(e.target.value)}
              placeholder="e.g. Compensation for overtime weekend duty / HR correction"
              className="w-full p-2.5 text-xs rounded-xl border border-slate-300"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => setIsAdjustOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={adjustMutation.isPending}>
              Apply Adjustment
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
