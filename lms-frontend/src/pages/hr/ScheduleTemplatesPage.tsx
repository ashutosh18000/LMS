import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, getFriendlyErrorMessage } from '../../lib/api-client';
import type { WorkScheduleTemplate, SaturdayMode } from '../../types/api';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { Modal } from '../../components/ui/modal';
import { Plus, Clock, AlertCircle, CheckCircle2 } from 'lucide-react';

export const ScheduleTemplatesPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [saturdayMode, setSaturdayMode] = useState<SaturdayMode>('alternate');
  const [alternateWeeks, setAlternateWeeks] = useState<'1,3' | '2,4'>('1,3');
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; message: string } | null>(null);

  const { data: templates = [], isLoading, error } = useQuery<WorkScheduleTemplate[]>({
    queryKey: ['hr-schedule-templates'],
    queryFn: () => apiRequest<WorkScheduleTemplate[]>('/schedule-templates'),
  });

  const createMutation = useMutation({
    mutationFn: (body: any) =>
      apiRequest('/schedule-templates', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setIsCreateOpen(false);
      setName('');
      setFeedback({ type: 'success', message: 'Work schedule template created!' });
      queryClient.invalidateQueries({ queryKey: ['hr-schedule-templates'] });
    },
    onError: (err) => setFeedback({ type: 'error', message: getFriendlyErrorMessage(err) }),
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const payload: any = {
      name: name.trim(),
      saturdayMode,
      alternateOffWeeks: saturdayMode === 'alternate' ? (alternateWeeks === '1,3' ? [1, 3] : [2, 4]) : [],
    };

    createMutation.mutate(payload);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Work Schedules</h1>
          <p className="text-xs text-slate-500 mt-1">Configure weekly off templates & Saturday modes</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-1.5" /> New Schedule Template
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
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Failed to load schedule templates.</span>
        </div>
      )}

      {templates.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((tpl) => (
            <Card key={tpl.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-900 text-sm">{tpl.name}</h3>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${tpl.active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                    {tpl.active ? 'Active' : 'Inactive'}
                  </span>
                </div>

                <div className="space-y-1 text-xs text-slate-600">
                  <div>
                    <span className="text-slate-400">Saturday Mode:</span>{' '}
                    <strong className="capitalize">{tpl.saturdayMode}</strong>
                  </div>
                  {tpl.saturdayMode === 'alternate' && (
                    <div>
                      <span className="text-slate-400">Alternate Off Weeks:</span>{' '}
                      <strong>{tpl.alternateOffWeeks?.join(', ')} Saturdays Off</strong>
                    </div>
                  )}
                  <div className="text-[11px] text-slate-400 pt-1">
                    Sunday is strictly Weekly Off (0 weight). Mon-Fri full working days.
                  </div>
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
        title="Create Schedule Template"
        description="Define Saturday working rules and alternate week arrangements"
      >
        <form onSubmit={handleCreate} className="space-y-4 pt-2">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Template Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Standard 5-Day Week, Alternate Saturday Off"
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Saturday Mode</label>
            <select
              value={saturdayMode}
              onChange={(e) => setSaturdayMode(e.target.value as SaturdayMode)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white"
            >
              <option value="off">Off (All Saturdays Off - 5 Day Week)</option>
              <option value="half">Half (All Saturdays Half Working Day)</option>
              <option value="alternate">Alternate (1st & 3rd or 2nd & 4th Off)</option>
              <option value="full">Full (All Saturdays Full Working Days - 6 Day Week)</option>
            </select>
          </div>

          {saturdayMode === 'alternate' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Alternate Off Pattern
              </label>
              <select
                value={alternateWeeks}
                onChange={(e) => setAlternateWeeks(e.target.value as any)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white"
              >
                <option value="1,3">1st & 3rd Saturdays Off (2nd & 4th Working)</option>
                <option value="2,4">2nd & 4th Saturdays Off (1st & 3rd Working)</option>
              </select>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={createMutation.isPending}>
              Create Template
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
