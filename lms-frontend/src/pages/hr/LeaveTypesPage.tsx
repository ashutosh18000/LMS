import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, getFriendlyErrorMessage } from '../../lib/api-client';
import type { LeaveType } from '../../types/api';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { Modal } from '../../components/ui/modal';
import { Plus, Check, X, AlertCircle, CheckCircle2 } from 'lucide-react';

export const LeaveTypesPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; message: string } | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [paid, setPaid] = useState(true);
  const [deductsBalance, setDeductsBalance] = useState(true);
  const [daysPerYear, setDaysPerYear] = useState<number>(12);
  const [carryForwardMax, setCarryForwardMax] = useState<number>(5);
  const [halfDayAllowed, setHalfDayAllowed] = useState(true);
  const [minNoticeDays, setMinNoticeDays] = useState<number>(0);
  const [isWfh, setIsWfh] = useState(false);
  const [monthlyLimit, setMonthlyLimit] = useState<number | ''>('');

  const { data: leaveTypes = [], isLoading, error } = useQuery<LeaveType[]>({
    queryKey: ['hr-leave-types'],
    queryFn: () => apiRequest<LeaveType[]>('/leave-types'),
  });

  const createMutation = useMutation({
    mutationFn: (body: any) => apiRequest('/leave-types', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setIsCreateOpen(false);
      setName('');
      setFeedback({ type: 'success', message: 'Leave type created successfully!' });
      queryClient.invalidateQueries({ queryKey: ['hr-leave-types'] });
      queryClient.invalidateQueries({ queryKey: ['leave-types-active'] });
    },
    onError: (err) => setFeedback({ type: 'error', message: getFriendlyErrorMessage(err) }),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/leave-types/${id}/deactivate`, { method: 'PATCH' }),
    onSuccess: () => {
      setFeedback({ type: 'success', message: 'Leave type deactivated.' });
      queryClient.invalidateQueries({ queryKey: ['hr-leave-types'] });
    },
    onError: (err) => setFeedback({ type: 'error', message: getFriendlyErrorMessage(err) }),
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/leave-types/${id}/reactivate`, { method: 'PATCH' }),
    onSuccess: () => {
      setFeedback({ type: 'success', message: 'Leave type reactivated.' });
      queryClient.invalidateQueries({ queryKey: ['hr-leave-types'] });
    },
    onError: (err) => setFeedback({ type: 'error', message: getFriendlyErrorMessage(err) }),
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const payload: any = {
      name: name.trim(),
      paid,
      deductsBalance: isWfh ? false : deductsBalance,
      daysPerYear: isWfh ? null : Number(daysPerYear),
      carryForwardMax: isWfh ? 0 : Number(carryForwardMax),
      halfDayAllowed,
      minNoticeDays: Number(minNoticeDays),
      isWfh,
      monthlyLimit: isWfh && monthlyLimit !== '' ? Number(monthlyLimit) : null,
    };

    createMutation.mutate(payload);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Leave Policies & Quotas</h1>
          <p className="text-xs text-slate-500 mt-1">Configure entitlement rules, carry-forward caps and WFH limits</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-1.5" /> New Leave Type
        </Button>
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

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-44 rounded-xl" />
          <Skeleton className="h-44 rounded-xl" />
          <Skeleton className="h-44 rounded-xl" />
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Failed to load leave types.</span>
        </div>
      )}

      {leaveTypes.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {leaveTypes.map((t) => (
            <Card key={t.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-900 text-sm">{t.name}</h3>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      t.isWfh
                        ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                        : 'bg-blue-50 text-blue-700 border-blue-200'
                    }`}
                  >
                    {t.isWfh ? 'WFH' : 'Leave'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-slate-100">
                  <div>
                    <span className="text-[10px] text-slate-400 block uppercase font-medium">Days / Year</span>
                    <span className="font-semibold text-slate-800">
                      {t.daysPerYear !== null ? `${t.daysPerYear} days` : 'Unlimited'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block uppercase font-medium">Carry Forward Cap</span>
                    <span className="font-semibold text-slate-800">{t.carryForwardMax} days</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block uppercase font-medium">Half-Day Allowed</span>
                    <span className="font-semibold text-slate-800">{t.halfDayAllowed ? 'Yes' : 'No'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block uppercase font-medium">Min Notice</span>
                    <span className="font-semibold text-slate-800">{t.minNoticeDays} days</span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-slate-100 text-xs">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${t.active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                    {t.active ? 'Active' : 'Inactive'}
                  </span>

                  {t.active ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => deactivateMutation.mutate(t.id)}
                    >
                      Deactivate
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => reactivateMutation.mutate(t.id)}
                    >
                      Reactivate
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Modal */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Create New Leave Type"
        description="Define leave entitlement rules, balance deduction, and policy caps"
      >
        <form onSubmit={handleCreate} className="space-y-4 pt-2">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Leave Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Annual Vacation, Casual Leave, Sick Leave"
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isWfh"
              checked={isWfh}
              onChange={(e) => {
                setIsWfh(e.target.checked);
                if (e.target.checked) {
                  setDeductsBalance(false);
                  setCarryForwardMax(0);
                }
              }}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="isWfh" className="text-xs font-semibold text-slate-700 cursor-pointer">
              Is this a Work From Home (WFH) type?
            </label>
          </div>

          {!isWfh ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Days Per Year</label>
                <input
                  type="number"
                  required
                  min={1}
                  max={365}
                  value={daysPerYear}
                  onChange={(e) => setDaysPerYear(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Carry Forward Max Cap</label>
                <input
                  type="number"
                  required
                  min={0}
                  max={daysPerYear}
                  value={carryForwardMax}
                  onChange={(e) => setCarryForwardMax(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300"
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Monthly Limit (Days)</label>
              <input
                type="number"
                min={1}
                max={31}
                value={monthlyLimit}
                onChange={(e) => setMonthlyLimit(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="Leave blank for unlimited"
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Min Notice (Days)</label>
              <input
                type="number"
                required
                min={0}
                value={minNoticeDays}
                onChange={(e) => setMinNoticeDays(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300"
              />
            </div>

            <div className="flex items-center pt-5">
              <input
                type="checkbox"
                id="halfDayAllowed"
                checked={halfDayAllowed}
                onChange={(e) => setHalfDayAllowed(e.target.checked)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 mr-2"
              />
              <label htmlFor="halfDayAllowed" className="text-xs font-semibold text-slate-700 cursor-pointer">
                Allow Half-Day
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={createMutation.isPending}>
              Create Policy
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
