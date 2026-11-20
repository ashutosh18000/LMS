import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, getFriendlyErrorMessage } from '../../lib/api-client';
import type { Holiday } from '../../types/api';
import { formatCalendarDate } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { Modal } from '../../components/ui/modal';
import { Plus, SunMedium, AlertCircle, CheckCircle2 } from 'lucide-react';

export const ManageHolidaysPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; message: string } | null>(null);

  const { data: holidays = [], isLoading, error } = useQuery<Holiday[]>({
    queryKey: ['hr-holidays-manage', selectedYear],
    queryFn: () => apiRequest<Holiday[]>(`/holidays/manage?year=${selectedYear}`),
  });

  const createMutation = useMutation({
    mutationFn: (body: any) => apiRequest('/holidays', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setIsAddOpen(false);
      setName('');
      setDate('');
      setFeedback({ type: 'success', message: 'Holiday created successfully!' });
      queryClient.invalidateQueries({ queryKey: ['hr-holidays-manage'] });
      queryClient.invalidateQueries({ queryKey: ['holidays'] });
    },
    onError: (err) => setFeedback({ type: 'error', message: getFriendlyErrorMessage(err) }),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/holidays/${id}/deactivate`, { method: 'PATCH' }),
    onSuccess: () => {
      setFeedback({ type: 'success', message: 'Holiday deactivated.' });
      queryClient.invalidateQueries({ queryKey: ['hr-holidays-manage'] });
      queryClient.invalidateQueries({ queryKey: ['holidays'] });
    },
    onError: (err) => setFeedback({ type: 'error', message: getFriendlyErrorMessage(err) }),
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/holidays/${id}/reactivate`, { method: 'PATCH' }),
    onSuccess: () => {
      setFeedback({ type: 'success', message: 'Holiday reactivated.' });
      queryClient.invalidateQueries({ queryKey: ['hr-holidays-manage'] });
      queryClient.invalidateQueries({ queryKey: ['holidays'] });
    },
    onError: (err) => setFeedback({ type: 'error', message: getFriendlyErrorMessage(err) }),
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !date) return;
    createMutation.mutate({ name: name.trim(), date });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Manage Holidays</h1>
          <p className="text-xs text-slate-500 mt-1">Add organization holidays and activate/deactivate dates</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-semibold bg-white"
          >
            <option value={2025}>2025</option>
            <option value={2026}>2026</option>
            <option value={2027}>2027</option>
          </select>
          <Button onClick={() => setIsAddOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" /> Add Holiday
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

      {isLoading && <Skeleton className="h-64 rounded-xl" />}

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Failed to load holidays list.</span>
        </div>
      )}

      {holidays.length > 0 && (
        <Card className="overflow-hidden">
          <div className="divide-y divide-slate-100">
            {holidays.map((h) => (
              <div key={h.id} className="p-4 flex items-center justify-between text-xs">
                <div>
                  <h4 className="font-bold text-slate-900 text-sm">{h.name}</h4>
                  <span className="text-slate-500 text-[11px] mt-0.5 block">
                    {formatCalendarDate(h.date)}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${h.active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                    {h.active ? 'Active' : 'Inactive'}
                  </span>

                  {h.active ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => deactivateMutation.mutate(h.id)}
                    >
                      Deactivate
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => reactivateMutation.mutate(h.id)}
                    >
                      Reactivate
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Add Holiday Modal */}
      <Modal
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        title="Add Organization Holiday"
        description="Declared holiday will be treated as non-working day for all employees"
      >
        <form onSubmit={handleCreate} className="space-y-4 pt-2">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Holiday Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Independence Day, Diwali, Christmas"
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Date</label>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => setIsAddOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={createMutation.isPending}>
              Save Holiday
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
