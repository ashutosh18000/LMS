import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, getFriendlyErrorMessage } from '../../lib/api-client';
import type { LeaveRequest, RequestStatus } from '../../types/api';
import { formatCalendarDate, statusBadgeColor } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { Modal } from '../../components/ui/modal';
import { Clock, Eye, XCircle, AlertCircle, CheckCircle2 } from 'lucide-react';

export const MyRequestsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedRequest, setSelectedRequest] = useState<LeaveRequest | null>(null);
  const [cancelTargetId, setCancelTargetId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<{ items: LeaveRequest[]; total: number }>({
    queryKey: ['my-requests', statusFilter],
    queryFn: () =>
      apiRequest<{ items: LeaveRequest[]; total: number }>('/leave-requests/mine', {
        params: { status: statusFilter || undefined, limit: 50 },
      }),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/leave-requests/${id}/cancel`, {
        method: 'POST',
      }),
    onSuccess: () => {
      setCancelTargetId(null);
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ['my-requests'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-me'] });
      queryClient.invalidateQueries({ queryKey: ['my-balances'] });
    },
    onError: (err) => {
      setActionError(getFriendlyErrorMessage(err));
    },
  });

  const handleConfirmCancel = () => {
    if (cancelTargetId) {
      cancelMutation.mutate(cancelTargetId);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">My Leave Requests</h1>
          <p className="text-xs text-slate-500 mt-1">Track status, segment breakdown, and cancel pending requests</p>
        </div>

        {/* Status Filter */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-600">Filter:</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {actionError && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Failed to load your requests.</span>
        </div>
      )}

      {data && (
        <div className="space-y-3">
          {data.items.length === 0 ? (
            <Card className="text-center py-12 text-slate-400 text-xs">
              No leave requests found for the selected filter.
            </Card>
          ) : (
            data.items.map((req) => (
              <Card key={req.id} className="hover:border-slate-300 transition-colors">
                <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2.5">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border uppercase ${statusBadgeColor(req.status)}`}>
                        {req.status}
                      </span>
                      <span className="text-xs font-semibold text-slate-900">
                        {req.segments[0]
                          ? `${formatCalendarDate(req.segments[0].startDate)} to ${formatCalendarDate(req.segments[req.segments.length - 1].endDate)}`
                          : 'Leave'}
                      </span>
                      {req.segments.length > 1 && (
                        <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium">
                          {req.segments.length} segments
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 line-clamp-1">{req.reason}</p>
                    <div className="text-[11px] text-slate-400">
                      Applied on {formatCalendarDate(req.createdAt)} &bull; Span: {req.spanDays} days &bull; Counted:{' '}
                      <strong className="text-slate-700">{req.countedDays} days</strong>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedRequest(req)}
                    >
                      <Eye className="w-3.5 h-3.5 mr-1" /> View Details
                    </Button>
                    {req.status === 'pending' && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setCancelTargetId(req.id)}
                      >
                        <XCircle className="w-3.5 h-3.5 mr-1" /> Cancel
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Detail Modal */}
      <Modal
        isOpen={!!selectedRequest}
        onClose={() => setSelectedRequest(null)}
        title="Leave Request Details"
        description={`Request ID: ${selectedRequest?.id}`}
      >
        {selectedRequest && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
              <div>
                <span className="block text-[10px] uppercase text-slate-400 font-semibold">Status</span>
                <span className={`inline-block mt-0.5 px-2 py-0.5 rounded text-[10px] font-bold border uppercase ${statusBadgeColor(selectedRequest.status)}`}>
                  {selectedRequest.status}
                </span>
              </div>
              <div>
                <span className="block text-[10px] uppercase text-slate-400 font-semibold">Counted Days</span>
                <span className="font-bold text-slate-800 text-sm">{selectedRequest.countedDays} working days</span>
              </div>
              <div>
                <span className="block text-[10px] uppercase text-slate-400 font-semibold">Span Duration</span>
                <span className="font-semibold text-slate-700">{selectedRequest.spanDays} calendar days</span>
              </div>
              <div>
                <span className="block text-[10px] uppercase text-slate-400 font-semibold">Submitted</span>
                <span className="text-slate-600">{formatCalendarDate(selectedRequest.createdAt)}</span>
              </div>
            </div>

            <div>
              <span className="block text-[10px] uppercase text-slate-400 font-semibold mb-1">Reason</span>
              <p className="p-2.5 rounded-lg bg-slate-50 text-slate-700 border border-slate-100">{selectedRequest.reason}</p>
            </div>

            {selectedRequest.decisionComment && (
              <div>
                <span className="block text-[10px] uppercase text-slate-400 font-semibold mb-1">Reviewer Comment</span>
                <p className="p-2.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200">{selectedRequest.decisionComment}</p>
              </div>
            )}

            <div>
              <span className="block text-[10px] uppercase text-slate-400 font-semibold mb-2">Segments Breakdown</span>
              <div className="space-y-1.5 divide-y divide-slate-100">
                {selectedRequest.segments.map((s) => (
                  <div key={s.id} className="pt-1.5 flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-slate-800">{s.leaveType.name}</span>
                      <span className="text-slate-400 ml-2">
                        {formatCalendarDate(s.startDate)} to {formatCalendarDate(s.endDate)}
                      </span>
                    </div>
                    <span className="font-semibold text-blue-700">
                      {s.countedDays} days ({s.portion})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Cancel Confirmation Dialog */}
      <Modal
        isOpen={!!cancelTargetId}
        onClose={() => setCancelTargetId(null)}
        title="Confirm Cancellation"
        description="Are you sure you want to cancel this pending leave request?"
      >
        <div className="space-y-4 pt-2">
          <p className="text-xs text-slate-600">
            Cancelling this pending request will automatically release the reserved days back to your available balance.
          </p>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setCancelTargetId(null)}>
              Keep Request
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleConfirmCancel}
              isLoading={cancelMutation.isPending}
            >
              Yes, Cancel Request
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
