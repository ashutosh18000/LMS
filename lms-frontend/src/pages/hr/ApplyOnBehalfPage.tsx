import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiRequest, getFriendlyErrorMessage } from '../../lib/api-client';
import type { User, LeaveType, Portion } from '../../types/api';
import { getTodayDateString } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Plus, Trash2, Send, AlertCircle, CheckCircle2 } from 'lucide-react';

interface SegmentState {
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  portion: Portion;
}

export const ApplyOnBehalfPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const today = getTodayDateString();

  const [targetUserId, setTargetUserId] = useState('');
  const [reason, setReason] = useState('');
  const [onBehalfReason, setOnBehalfReason] = useState('');
  const [autoApprove, setAutoApprove] = useState(true);
  const [segments, setSegments] = useState<SegmentState[]>([
    {
      leaveTypeId: '',
      startDate: today,
      endDate: today,
      portion: 'full',
    },
  ]);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Fetch users for target selection
  const { data: usersData, isLoading: isLoadingUsers } = useQuery<{ items: User[] }>({
    queryKey: ['hr-users-list'],
    queryFn: () => apiRequest<{ items: User[] }>('/users?limit=100'),
  });

  // Fetch leave types
  const { data: leaveTypes = [] } = useQuery<LeaveType[]>({
    queryKey: ['leave-types-active'],
    queryFn: () => apiRequest<LeaveType[]>('/leave-types'),
  });

  const mutation = useMutation({
    mutationFn: (body: any) =>
      apiRequest('/leave-requests/on-behalf', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setSuccessMessage('Leave applied on-behalf successfully!');
      setErrorMessage(null);
      queryClient.invalidateQueries({ queryKey: ['pending-approvals'] });
      setTimeout(() => {
        navigate('/hr/approvals');
      }, 1200);
    },
    onError: (err) => {
      setErrorMessage(getFriendlyErrorMessage(err));
    },
  });

  const handleAddSegment = () => {
    if (segments.length >= 10) return;
    setSegments([
      ...segments,
      {
        leaveTypeId: leaveTypes[0]?.id || '',
        startDate: today,
        endDate: today,
        portion: 'full',
      },
    ]);
  };

  const handleRemoveSegment = (index: number) => {
    if (segments.length <= 1) return;
    setSegments(segments.filter((_, i) => i !== index));
  };

  const handleSegmentChange = (index: number, field: keyof SegmentState, value: any) => {
    const updated = [...segments];
    updated[index] = { ...updated[index], [field]: value };
    setSegments(updated);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetUserId) {
      setErrorMessage('Please select a target employee.');
      return;
    }
    if (!onBehalfReason.trim()) {
      setErrorMessage('Please provide an administrative on-behalf reason for audit log.');
      return;
    }
    if (!reason.trim()) {
      setErrorMessage('Please provide a general leave reason.');
      return;
    }

    setErrorMessage(null);
    mutation.mutate({
      targetUserId,
      reason: reason.trim(),
      onBehalfReason: onBehalfReason.trim(),
      autoApprove,
      segments,
    });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Apply Leave On-Behalf</h1>
        <p className="text-xs text-slate-500 mt-1">
          Apply leave for staff (supports backdates and instant auto-approval with audit tracking)
        </p>
      </div>

      {errorMessage && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {successMessage && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">1. Target Employee & Authorization</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Employee <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  value={targetUserId}
                  onChange={(e) => setTargetUserId(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select an employee</option>
                  {usersData?.items?.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.email}) - {u.role}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  On-Behalf Reason (Audit Log) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={onBehalfReason}
                  onChange={(e) => setOnBehalfReason(e.target.value)}
                  placeholder="e.g. Employee had medical emergency / phone intimation"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                General Leave Reason
              </label>
              <textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Applicant reason..."
                className="w-full p-2.5 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="autoApprove"
                checked={autoApprove}
                onChange={(e) => setAutoApprove(e.target.checked)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="autoApprove" className="text-xs font-medium text-slate-700 cursor-pointer">
                Auto-approve this request immediately (bypass pending approval queue)
              </label>
            </div>
          </CardContent>
        </Card>

        {/* Date Segments */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm">2. Date Segments</CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddSegment}
              disabled={segments.length >= 10}
            >
              <Plus className="w-3.5 h-3.5 mr-1" /> Add Segment
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {segments.map((seg, idx) => (
              <div
                key={idx}
                className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3"
              >
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                  <span>Segment #{idx + 1}</span>
                  {segments.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveSegment(idx)}
                      className="text-slate-400 hover:text-rose-600 p-1"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Type
                    </label>
                    <select
                      value={seg.leaveTypeId}
                      onChange={(e) => handleSegmentChange(idx, 'leaveTypeId', e.target.value)}
                      className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select type</option>
                      {leaveTypes.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Start Date
                    </label>
                    <input
                      type="date"
                      required
                      value={seg.startDate}
                      onChange={(e) => handleSegmentChange(idx, 'startDate', e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      End Date
                    </label>
                    <input
                      type="date"
                      required
                      value={seg.endDate}
                      onChange={(e) => handleSegmentChange(idx, 'endDate', e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Portion
                    </label>
                    <select
                      value={seg.portion}
                      onChange={(e) => handleSegmentChange(idx, 'portion', e.target.value as Portion)}
                      className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 bg-white"
                    >
                      <option value="full">Full Day</option>
                      <option value="first_half">First Half</option>
                      <option value="second_half">Second Half</option>
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" isLoading={mutation.isPending}>
            <Send className="w-4 h-4 mr-1.5" /> Submit On-Behalf Request
          </Button>
        </div>
      </form>
    </div>
  );
};
