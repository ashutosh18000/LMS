import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, getFriendlyErrorMessage } from '../../lib/api-client';
import { useAuth } from '../../context/AuthContext';
import type { LeaveRequest } from '../../types/api';
import { formatCalendarDate } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { Modal } from '../../components/ui/modal';
import { CheckCircle2, XCircle, Eye, AlertCircle, Clock, ShieldAlert } from 'lucide-react';

export const ApprovalsInboxPage: React.FC = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [selectedRequest, setSelectedRequest] = useState<LeaveRequest | null>(null);
  const [rejectTarget, setRejectTarget] = useState<LeaveRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [approveComment, setApproveComment] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: requests = [], isLoading, error } = useQuery<LeaveRequest[]>({
    queryKey: ['pending-approvals'],
    queryFn: () => apiRequest<LeaveRequest[]>('/approvals/pending'),
  });

  // Approve Mutation
  const approveMutation = useMutation({
    mutationFn: ({ id, comment }: { id: string; comment?: string }) =>
      apiRequest(`/approvals/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ comment }),
      }),
    onSuccess: () => {
      setSelectedRequest(null);
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ['pending-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-hr'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-owner'] });
    },
    onError: (err) => {
      setActionError(getFriendlyErrorMessage(err));
    },
  });

  // Reject Mutation
  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiRequest(`/approvals/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      setRejectTarget(null);
      setRejectReason('');
      setSelectedRequest(null);
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ['pending-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-hr'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-owner'] });
    },
    onError: (err) => {
      setActionError(getFriendlyErrorMessage(err));
    },
  });

  const handleApprove = (req: LeaveRequest) => {
    approveMutation.mutate({ id: req.id, comment: approveComment || undefined });
  };

  const handleConfirmReject = () => {
    if (!rejectReason.trim()) {
      setActionError('A rejection reason is required.');
      return;
    }
    if (rejectTarget) {
      rejectMutation.mutate({ id: rejectTarget.id, reason: rejectReason.trim() });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Pending Approvals Inbox</h1>
        <p className="text-xs text-slate-500 mt-1">
          Review, approve, or reject employee leave and WFH requests
        </p>
      </div>

      {actionError && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Failed to load pending approvals.</span>
        </div>
      )}

      {!isLoading && requests.length === 0 && (
        <Card className="text-center py-16 text-slate-400 text-xs">
          <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-80" />
          <p className="font-semibold text-slate-700 text-sm">Inbox Zero!</p>
          <p className="mt-1">All leave requests have been reviewed.</p>
        </Card>
      )}

      {requests.length > 0 && (
        <div className="space-y-4">
          {requests.map((req) => {
            const isSelf = req.userId === user?.id;

            return (
              <Card key={req.id} className="hover:border-slate-300 transition-colors">
                <CardContent className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 text-sm">{req.user?.name}</span>
                      <span className="text-[10px] font-semibold text-slate-400 uppercase">
                        ({req.user?.role?.replace('_', ' ')}) &bull; {req.user?.department || 'General'}
                      </span>
                      {isSelf && (
                        <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded border border-amber-200">
                          Your Request
                        </span>
                      )}
                    </div>

                    <div className="text-xs text-slate-600 font-medium">
                      {req.segments[0]
                        ? `${formatCalendarDate(req.segments[0].startDate)} to ${formatCalendarDate(req.segments[req.segments.length - 1].endDate)}`
                        : 'Leave Period'}
                      <span className="text-slate-400 ml-2">
                        ({req.countedDays} working days &bull; {req.spanDays} calendar span)
                      </span>
                    </div>

                    <p className="text-xs text-slate-500 italic bg-slate-50 p-2 rounded-lg border border-slate-100 max-w-2xl">
                      "{req.reason}"
                    </p>

                    <div className="text-[10px] text-slate-400">
                      Applied on {formatCalendarDate(req.createdAt)}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <Button variant="outline" size="sm" onClick={() => setSelectedRequest(req)}>
                      <Eye className="w-3.5 h-3.5 mr-1" /> View Breakdown
                    </Button>

                    {isSelf ? (
                      <span className="text-[11px] text-amber-700 font-medium bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200">
                        Self-approval disabled
                      </span>
                    ) : (
                      <>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            setRejectTarget(req);
                            setRejectReason('');
                            setActionError(null);
                          }}
                        >
                          <XCircle className="w-3.5 h-3.5 mr-1" /> Reject
                        </Button>
                        <Button
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-700 shadow-sm shadow-emerald-500/20 text-white"
                          onClick={() => handleApprove(req)}
                          isLoading={approveMutation.isPending}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Approve
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Reject Modal with Reason */}
      <Modal
        isOpen={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
        title="Reject Leave Request"
        description={`Applicant: ${rejectTarget?.user?.name}`}
      >
        <div className="space-y-4 pt-2">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Rejection Reason <span className="text-rose-500">*</span>
            </label>
            <textarea
              required
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="State clear reason for rejection (e.g. Project deliverable deadline, team capacity constraint)..."
              className="w-full p-2.5 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-rose-500"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setRejectTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleConfirmReject}
              isLoading={rejectMutation.isPending}
            >
              Confirm Rejection
            </Button>
          </div>
        </div>
      </Modal>

      {/* View Breakdown Modal */}
      <Modal
        isOpen={!!selectedRequest}
        onClose={() => setSelectedRequest(null)}
        title="Request Breakdown & Segments"
        description={`Applicant: ${selectedRequest?.user?.name}`}
      >
        {selectedRequest && (
          <div className="space-y-4 text-xs">
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Total Days Counted</span>
                <span className="text-base font-bold text-blue-700">{selectedRequest.countedDays} days</span>
              </div>
              <div className="text-right">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Span Duration</span>
                <span className="text-sm font-semibold text-slate-700">{selectedRequest.spanDays} days</span>
              </div>
            </div>

            <div className="space-y-2">
              <span className="font-semibold text-slate-800 block">Segments:</span>
              <div className="divide-y divide-slate-100">
                {selectedRequest.segments.map((seg) => (
                  <div key={seg.id} className="py-2 flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-slate-800">{seg.leaveType.name}</span>
                      <div className="text-[11px] text-slate-400">
                        {formatCalendarDate(seg.startDate)} to {formatCalendarDate(seg.endDate)}
                      </div>
                    </div>
                    <span className="font-bold text-slate-700">
                      {seg.countedDays} days ({seg.portion})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
