import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, getFriendlyErrorMessage } from '../../lib/api-client';
import type { Organization } from '../../types/api';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { Save, AlertCircle, CheckCircle2 } from 'lucide-react';

export const OrgSettingsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [financialYearStartMonth, setFinancialYearStartMonth] = useState<number>(4);
  const [workingDays, setWorkingDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [backdateAllowedDays, setBackdateAllowedDays] = useState<number>(7);

  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; message: string } | null>(null);

  const { data: org, isLoading, error } = useQuery<Organization>({
    queryKey: ['org-settings'],
    queryFn: () => apiRequest<Organization>('/org/settings'),
  });

  useEffect(() => {
    if (org) {
      setTimezone(org.timezone || 'Asia/Kolkata');
      setFinancialYearStartMonth(org.financialYearStartMonth || 4);
      setWorkingDays(org.workingDays || [1, 2, 3, 4, 5]);
      setBackdateAllowedDays(org.backdateAllowedDays ?? 7);
    }
  }, [org]);

  const updateMutation = useMutation({
    mutationFn: (body: any) =>
      apiRequest('/org/settings', { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      setFeedback({ type: 'success', message: 'Organization settings saved successfully!' });
      queryClient.invalidateQueries({ queryKey: ['org-settings'] });
    },
    onError: (err) => setFeedback({ type: 'error', message: getFriendlyErrorMessage(err) }),
  });

  const toggleWorkingDay = (day: number) => {
    if (workingDays.includes(day)) {
      if (workingDays.length <= 1) return; // at least 1 day required
      setWorkingDays(workingDays.filter((d) => d !== day));
    } else {
      setWorkingDays([...workingDays, day].sort());
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate({
      timezone,
      financialYearStartMonth: Number(financialYearStartMonth),
      workingDays,
      backdateAllowedDays: Number(backdateAllowedDays),
    });
  };

  const daysLabels = [
    { day: 1, label: 'Mon' },
    { day: 2, label: 'Tue' },
    { day: 3, label: 'Wed' },
    { day: 4, label: 'Thu' },
    { day: 5, label: 'Fri' },
    { day: 6, label: 'Sat' },
    { day: 7, label: 'Sun' },
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Organization Settings</h1>
        <p className="text-xs text-slate-500 mt-1">
          Configure default working days, timezone, financial year cycle, and backdate grace period
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

      {isLoading && <Skeleton className="h-96 rounded-2xl" />}

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Failed to load settings.</span>
        </div>
      )}

      {org && (
        <form onSubmit={handleSubmit}>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Policy Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  IANA Timezone
                </label>
                <input
                  type="text"
                  required
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder="e.g. Asia/Kolkata, America/New_York, UTC"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Financial Year Start Month
                </label>
                <select
                  value={financialYearStartMonth}
                  onChange={(e) => setFinancialYearStartMonth(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white"
                >
                  <option value={1}>January (Month 1)</option>
                  <option value={4}>April (Month 4 - India standard)</option>
                  <option value={7}>July (Month 7)</option>
                  <option value={10}>October (Month 10)</option>
                </select>
                <p className="text-[11px] text-slate-400 mt-1">
                  Note: Cannot be modified once leave balance rows have been allocated.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Default Organization Working Days
                </label>
                <div className="flex flex-wrap gap-2">
                  {daysLabels.map(({ day, label }) => {
                    const isSelected = workingDays.includes(day);
                    return (
                      <button
                        type="button"
                        key={day}
                        onClick={() => toggleWorkingDay(day)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                          isSelected
                            ? 'bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-500/20'
                            : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Allowed Backdated Leave Window (Days)
                </label>
                <input
                  type="number"
                  min={0}
                  max={90}
                  required
                  value={backdateAllowedDays}
                  onChange={(e) => setBackdateAllowedDays(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Employees can apply for leave up to this many days in the past.
                </p>
              </div>

              <div className="flex justify-end pt-2">
                <Button type="submit" isLoading={updateMutation.isPending}>
                  <Save className="w-4 h-4 mr-1.5" /> Save Changes
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      )}
    </div>
  );
};
