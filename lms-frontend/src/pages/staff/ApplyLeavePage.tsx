import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiRequest, getFriendlyErrorMessage, ApiError } from '../../lib/api-client';
import type { LeaveType, Portion, LeaveRequestPreview } from '../../types/api';
import { getTodayDateString, formatCalendarDate } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Plus, Trash2, Calculator, Send, AlertCircle, CheckCircle2, Info } from 'lucide-react';

interface SegmentFormState {
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  portion: Portion;
}

export const ApplyLeavePage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const today = getTodayDateString();

  const [reason, setReason] = useState('');
  const [segments, setSegments] = useState<SegmentFormState[]>([
    {
      leaveTypeId: '',
      startDate: today,
      endDate: today,
      portion: 'full',
    },
  ]);

  const [previewData, setPreviewData] = useState<LeaveRequestPreview | null>(null);
  const [errorDetails, setErrorDetails] = useState<{
    code?: string;
    message: string;
    nextFreeDate?: string;
    conflicts?: any[];
  } | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Fetch available active leave types
  const { data: leaveTypes = [], isLoading: isLoadingTypes } = useQuery<LeaveType[]>({
    queryKey: ['leave-types-active'],
    queryFn: () => apiRequest<LeaveType[]>('/leave-types'),
  });

  // Preview mutation (POST /leave-requests/preview)
  const previewMutation = useMutation({
    mutationFn: (body: { reason: string; segments: SegmentFormState[] }) =>
      apiRequest<LeaveRequestPreview>('/leave-requests/preview', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      setPreviewData(data);
      setErrorDetails(null);
    },
    onError: (err: any) => {
      setPreviewData(null);
      if (err instanceof ApiError) {
        setErrorDetails({
          code: err.code,
          message: getFriendlyErrorMessage(err),
          nextFreeDate: err.details?.nextFreeDate,
          conflicts: err.details?.conflicts,
        });
      } else {
        setErrorDetails({ message: err?.message || 'Calculation failed' });
      }
    },
  });

  // Submit mutation (POST /leave-requests)
  const submitMutation = useMutation({
    mutationFn: (body: { reason: string; segments: SegmentFormState[] }) =>
      apiRequest('/leave-requests', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setSuccessMessage('Leave application submitted successfully!');
      setErrorDetails(null);
      queryClient.invalidateQueries({ queryKey: ['dashboard-me'] });
      queryClient.invalidateQueries({ queryKey: ['my-balances'] });
      queryClient.invalidateQueries({ queryKey: ['my-requests'] });
      setTimeout(() => {
        navigate('/my-requests');
      }, 1200);
    },
    onError: (err: any) => {
      if (err instanceof ApiError) {
        setErrorDetails({
          code: err.code,
          message: getFriendlyErrorMessage(err),
          nextFreeDate: err.details?.nextFreeDate,
          conflicts: err.details?.conflicts,
        });
      } else {
        setErrorDetails({ message: err?.message || 'Submission failed' });
      }
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

  const handleSegmentChange = (index: number, field: keyof SegmentFormState, value: any) => {
    const updated = [...segments];
    updated[index] = { ...updated[index], [field]: value };
    setSegments(updated);
  };

  const validateAndPrepare = () => {
    if (!reason.trim()) {
      setErrorDetails({ message: 'Please provide a reason for your leave application.' });
      return null;
    }

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (!seg.leaveTypeId) {
        setErrorDetails({ message: `Please select a leave type for Segment #${i + 1}.` });
        return null;
      }
      if (seg.startDate > seg.endDate) {
        setErrorDetails({
          message: `Segment #${i + 1}: Start date cannot be after end date.`,
        });
        return null;
      }
    }

    return { reason: reason.trim(), segments };
  };

  const handlePreview = () => {
    const payload = validateAndPrepare();
    if (payload) {
      previewMutation.mutate(payload);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = validateAndPrepare();
    if (payload) {
      submitMutation.mutate(payload);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Apply for Leave / WFH</h1>
        <p className="text-xs text-slate-500 mt-1">
          Combine multiple leave types and date ranges in a single request (e.g. Leave &bull; WFH &bull; Leave)
        </p>
      </div>

      {/* Error Alert Box */}
      {errorDetails && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs space-y-2">
          <div className="flex items-center gap-2 font-semibold">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorDetails.code ? `Error: ${errorDetails.code}` : 'Validation Error'}</span>
          </div>
          <p className="text-rose-700">{errorDetails.message}</p>
          {errorDetails.nextFreeDate && (
            <div className="pt-2 border-t border-rose-200/60 text-slate-700">
              💡 Suggested next free date to apply: <strong className="text-blue-700">{formatCalendarDate(errorDetails.nextFreeDate)}</strong>
            </div>
          )}
        </div>
      )}

      {/* Success Alert */}
      {successMessage && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span className="font-semibold">{successMessage}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Reason Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">1. Reason for Request</CardTitle>
          </CardHeader>
          <CardContent>
            <textarea
              required
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain the purpose of your leave or WFH (e.g. Family function, personal travel, medical recovery)..."
              className="w-full p-3 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </CardContent>
        </Card>

        {/* Multi-Segment Cards */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm">2. Date Segments ({segments.length}/10)</CardTitle>
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
                className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3 relative group"
              >
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                  <span>Segment #{idx + 1}</span>
                  {segments.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveSegment(idx)}
                      className="text-slate-400 hover:text-rose-600 transition-colors p-1"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  {/* Leave Type Select */}
                  <div className="sm:col-span-1">
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Type
                    </label>
                    <select
                      value={seg.leaveTypeId}
                      onChange={(e) => handleSegmentChange(idx, 'leaveTypeId', e.target.value)}
                      className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select leave type</option>
                      {leaveTypes.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} {t.isWfh ? '(WFH)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Start Date */}
                  <div className="sm:col-span-1">
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Start Date
                    </label>
                    <input
                      type="date"
                      required
                      value={seg.startDate}
                      onChange={(e) => handleSegmentChange(idx, 'startDate', e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {/* End Date */}
                  <div className="sm:col-span-1">
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      End Date
                    </label>
                    <input
                      type="date"
                      required
                      value={seg.endDate}
                      onChange={(e) => handleSegmentChange(idx, 'endDate', e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {/* Portion (Full / Half day) */}
                  <div className="sm:col-span-1">
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Portion
                    </label>
                    <select
                      value={seg.portion}
                      onChange={(e) => handleSegmentChange(idx, 'portion', e.target.value as Portion)}
                      className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
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

        {/* Calculation Preview Box */}
        {previewData && (
          <div className="p-4 rounded-2xl bg-blue-50/70 border border-blue-200 text-xs space-y-3 animate-in fade-in">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-blue-900">
                <Info className="w-4 h-4 text-blue-600" />
                <span>Calculation Preview</span>
              </div>
              <div className="text-right">
                <span className="text-slate-500">Span: {previewData.spanDays} days &bull; </span>
                <span className="font-bold text-blue-800 text-sm">
                  Counted: {previewData.countedDays} working days
                </span>
              </div>
            </div>

            <div className="max-h-40 overflow-y-auto space-y-1 divide-y divide-blue-100">
              {previewData.breakdown.map((b, i) => (
                <div key={i} className="pt-1 flex items-center justify-between text-[11px] text-slate-700">
                  <span>{formatCalendarDate(b.date)}</span>
                  <span>
                    {b.skipReason === 'weekly_off' ? (
                      <span className="text-slate-400">Weekly Off (0 days)</span>
                    ) : b.skipReason === 'holiday' ? (
                      <span className="text-orange-600 font-medium">Holiday (0 days)</span>
                    ) : (
                      <span className="font-semibold text-blue-700">{b.countedWeight} days ({b.portion})</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions Buttons */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={handlePreview}
            isLoading={previewMutation.isPending}
          >
            <Calculator className="w-4 h-4 mr-1.5" /> Preview Days & Breakdown
          </Button>
          <Button
            type="submit"
            isLoading={submitMutation.isPending}
            className="shadow-sm shadow-blue-500/20"
          >
            <Send className="w-4 h-4 mr-1.5" /> Submit Request
          </Button>
        </div>
      </form>
    </div>
  );
};
