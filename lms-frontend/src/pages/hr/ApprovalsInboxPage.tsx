import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, getFriendlyErrorMessage } from '../../lib/api-client';
import { useAuth } from '../../context/AuthContext';
import type {
  PendingApprovalItem,
  PendingApprovalsResponse,
  SegmentDecisionItem,
  DecideResponse,
} from '../../types/api';
import { formatCalendarDate, formatStatusLabel, statusBadgeColor } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { Modal } from '../../components/ui/modal';
import {
  CheckCircle2,
  XCircle,
  Eye,
  AlertCircle,
  Shield,
  Check,
  X,
  MessageSquare,
} from 'lucide-react';

export const ApprovalsInboxPage: React.FC = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [selectedRequest, setSelectedRequest] = useState<PendingApprovalItem | null>(null);
  const [segmentDecisions, setSegmentDecisions] = useState<
    Record<string, { action: 'approve' | 'reject'; comment: string }>
  >({});
  const [commonRejectComment, setCommonRejectComment] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Fetch pending approvals
  const { data, isLoading, error } = useQuery<PendingApprovalsResponse>({
    queryKey: ['pending-approvals'],
    queryFn: () => apiRequest<PendingApprovalsResponse>('/approvals/pending'),
  });
  const requests = data?.items ?? [];

  // Segment-wise Decide Mutation (POST /approvals/:requestId/decide)
  const decideMutation = useMutation({
    mutationFn: ({
      requestId,
      decisions,
    }: {
      requestId: string;
      decisions: SegmentDecisionItem[];
    }) =>
      apiRequest<DecideResponse>(`/approvals/${requestId}/decide`, {
        method: 'POST',
        body: JSON.stringify({ decisions }),
      }),
    onSuccess: (res) => {
      setSelectedRequest(null);
      setSegmentDecisions({});
      setActionError(null);
      setActionSuccess(res.message || 'Leave request decided successfully.');
      queryClient.invalidateQueries({ queryKey: ['pending-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-hr'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-owner'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
    onError: (err) => {
      setActionError(getFriendlyErrorMessage(err));
    },
  });

  // Open modal and initialize decisions state
  const handleOpenReview = (req: PendingApprovalItem) => {
    setSelectedRequest(req);
    setActionError(null);
    setActionSuccess(null);
    const initial: Record<string, { action: 'approve' | 'reject'; comment: string }> = {};
    for (const seg of req.segments ?? []) {
      if (!seg.status || seg.status === 'pending') {
        // Leave unselected by default so HR explicitly chooses
      }
    }
    setSegmentDecisions(initial);
    setCommonRejectComment('');
  };

  // Toggle single segment decision
  const handleToggleSegmentAction = (segmentId: string, action: 'approve' | 'reject') => {
    setSegmentDecisions((prev) => ({
      ...prev,
      [segmentId]: {
        action,
        comment: prev[segmentId]?.comment || '',
      },
    }));
  };

  // Update comment for a rejected segment
  const handleSegmentCommentChange = (segmentId: string, comment: string) => {
    setSegmentDecisions((prev) => ({
      ...prev,
      [segmentId]: {
        action: prev[segmentId]?.action || 'reject',
        comment,
      },
    }));
  };

  // Shortcut: Approve All Segments
  const handleApproveAll = () => {
    if (!selectedRequest) return;
    const updated: Record<string, { action: 'approve' | 'reject'; comment: string }> = {};
    for (const seg of selectedRequest.segments ?? []) {
      if (!seg.status || seg.status === 'pending') {
        updated[seg.id] = {
          action: 'approve',
          comment: segmentDecisions[seg.id]?.comment || '',
        };
      }
    }
    setSegmentDecisions(updated);
  };

  // Shortcut: Reject All Segments
  const handleRejectAll = () => {
    if (!selectedRequest) return;
    const commentToApply = commonRejectComment.trim() || 'Request rejected based on operational requirements.';
    const updated: Record<string, { action: 'approve' | 'reject'; comment: string }> = {};
    for (const seg of selectedRequest.segments ?? []) {
      if (!seg.status || seg.status === 'pending') {
        updated[seg.id] = {
          action: 'reject',
          comment: segmentDecisions[seg.id]?.comment || commentToApply,
        };
      }
    }
    setSegmentDecisions(updated);
  };

  // Validation helpers
  const pendingSegments =
    selectedRequest?.segments?.filter((s) => !s.status || s.status === 'pending') ?? [];
  const totalPending = pendingSegments.length;
  const decidedCount = pendingSegments.filter((s) => segmentDecisions[s.id]?.action).length;
  const undecidedCount = totalPending - decidedCount;

  const hasMissingComments = pendingSegments.some(
    (s) =>
      segmentDecisions[s.id]?.action === 'reject' &&
      !segmentDecisions[s.id]?.comment?.trim(),
  );

  const canSubmit = totalPending > 0 && undecidedCount === 0 && !hasMissingComments;

  // Handle final submission
  const handleSubmitDecisions = () => {
    if (!selectedRequest || !canSubmit) return;

    const payload: SegmentDecisionItem[] = pendingSegments.map((s) => {
      const dec = segmentDecisions[s.id];
      return {
        segmentId: s.id,
        action: dec.action,
        comment: dec.comment?.trim() ? dec.comment.trim() : undefined,
      };
    });

    decideMutation.mutate({
      requestId: selectedRequest.id,
      decisions: payload,
    });
  };

  // Permission checks for caller
  const getPermissionStatus = (req: PendingApprovalItem) => {
    const isSelf = req.requester?.id === user?.id;
    const isHrAdminRequester = req.requester?.role === 'hr_admin';
    const isOwnerOrRoot = user?.role === 'org_owner' || user?.role === 'root';

    if (isSelf) {
      return {
        canDecide: false,
        message: 'Self-approval disabled: You cannot decide on your own request.',
      };
    }

    if (isHrAdminRequester && !isOwnerOrRoot) {
      return {
        canDecide: false,
        message: 'HR Admin requests can only be decided by the Organization Owner.',
      };
    }

    return {
      canDecide: true,
      message: null,
    };
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Pending Approvals Inbox</h1>
          <p className="text-xs text-slate-500 mt-1">
            Review and submit segment-wise decisions for employee leave and WFH requests
          </p>
        </div>
        <div className="text-xs font-semibold text-slate-500 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-sm">
          Pending in Queue: <strong className="text-blue-700">{requests.length}</strong>
        </div>
      </div>

      {actionSuccess && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{actionSuccess}</span>
          </div>
          <button
            onClick={() => setActionSuccess(null)}
            className="text-emerald-700 hover:text-emerald-900 text-xs font-bold"
          >
            &times;
          </button>
        </div>
      )}

      {actionError && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{actionError}</span>
          </div>
          <button
            onClick={() => setActionError(null)}
            className="text-rose-700 hover:text-rose-900 text-xs font-bold"
          >
            &times;
          </button>
        </div>
      )}

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Failed to load pending approvals from server.</span>
        </div>
      )}

      {!isLoading && requests.length === 0 && (
        <Card className="text-center py-16 text-slate-400 text-xs">
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2 opacity-80" />
          <p className="font-semibold text-slate-800 text-sm">Inbox Zero!</p>
          <p className="mt-1">All leave requests have been reviewed and decided.</p>
        </Card>
      )}

      {requests.length > 0 && (
        <div className="space-y-4">
          {requests.map((req) => {
            const { canDecide, message: permissionNotice } = getPermissionStatus(req);

            return (
              <Card key={req.id} className="hover:border-slate-300 transition-colors">
                <CardContent className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1.5 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-slate-900 text-sm">
                        {req.requester?.name || 'Employee'}
                      </span>
                      <span className="text-[10px] font-semibold text-slate-400 uppercase">
                        ({(req.requester?.role ?? '').replace('_', ' ') || 'Employee'}) &bull;{' '}
                        {req.requester?.department || 'General'}
                      </span>
                      {!canDecide && (
                        <span className="text-[10px] bg-amber-50 text-amber-800 font-semibold px-2 py-0.5 rounded border border-amber-200">
                          {permissionNotice}
                        </span>
                      )}
                    </div>

                    <div className="text-xs text-slate-600 font-medium">
                      {req.segments?.[0]
                        ? `${formatCalendarDate(req.segments[0].startDate)} to ${formatCalendarDate(
                            req.segments[req.segments.length - 1]?.endDate ?? req.segments[0].endDate,
                          )}`
                        : 'Leave Period'}
                      <span className="text-slate-400 ml-2">
                        ({req.countedDays} working days &bull; {req.spanDays} calendar days)
                      </span>
                      {(req.segments?.length ?? 0) > 1 && (
                        <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                          {req.segments?.length} Segments
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-600 italic bg-slate-50 p-2 rounded-lg border border-slate-100 max-w-2xl">
                      "{req.reason}"
                    </p>

                    <div className="text-[10px] text-slate-400">
                      Applied on {formatCalendarDate(req.createdAt)}
                      {req.createdBy && ` &bull; By ${req.createdBy}`}
                    </div>
                  </div>

                  {/* Review / Decision Trigger */}
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <Button
                      variant={canDecide ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handleOpenReview(req)}
                      className={canDecide ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm' : ''}
                    >
                      <Eye className="w-3.5 h-3.5 mr-1.5" />
                      {canDecide ? 'Review & Decide' : 'View Details'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Segment-Wise Decision Modal */}
      <Modal
        isOpen={!!selectedRequest}
        onClose={() => {
          setSelectedRequest(null);
          setSegmentDecisions({});
        }}
        title="Review & Decide Leave Request"
        description={`Applicant: ${selectedRequest?.requester?.name || 'Employee'} (${(selectedRequest?.requester?.role ?? '').replace('_', ' ') || 'Staff'})`}
      >
        {selectedRequest && (() => {
          const { canDecide, message: permissionNotice } = getPermissionStatus(selectedRequest);

          return (
            <div className="space-y-4 text-xs pt-1">
              {/* Permission Banner if cannot decide */}
              {!canDecide && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-2">
                  <Shield className="w-4 h-4 shrink-0 text-amber-600" />
                  <span>{permissionNotice}</span>
                </div>
              )}

              {/* Request Overview Header */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div>
                  <span className="block text-[10px] uppercase text-slate-400 font-semibold">Total Counted</span>
                  <span className="font-bold text-blue-700 text-sm">{selectedRequest.countedDays} days</span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase text-slate-400 font-semibold">Span Duration</span>
                  <span className="font-semibold text-slate-700 text-sm">{selectedRequest.spanDays} days</span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase text-slate-400 font-semibold">Department</span>
                  <span className="text-slate-700 font-medium">{selectedRequest.requester?.department || 'General'}</span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase text-slate-400 font-semibold">Applied On</span>
                  <span className="text-slate-600 font-medium">{formatCalendarDate(selectedRequest.createdAt)}</span>
                </div>
              </div>

              {/* Applicant's Reason */}
              <div>
                <span className="block text-[10px] uppercase text-slate-400 font-semibold mb-1">
                  Applicant's Stated Reason
                </span>
                <p className="p-2.5 rounded-lg bg-slate-50 text-slate-700 border border-slate-100">
                  {selectedRequest.reason}
                </p>
              </div>

              {/* Segment Decision Section */}
              <div className="space-y-3 pt-1">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <span className="block text-[11px] uppercase text-slate-600 font-bold tracking-wider">
                    Segment-Wise Decisions ({decidedCount}/{totalPending} decided)
                  </span>

                  {/* Shortcuts (Approve all / Reject all) */}
                  {canDecide && totalPending > 0 && (
                    <div className="flex items-center gap-1.5 self-start sm:self-center">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleApproveAll}
                        className="text-emerald-700 border-emerald-200 hover:bg-emerald-50 text-[11px] h-7 px-2.5"
                      >
                        <Check className="w-3 h-3 mr-1" /> Approve All
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleRejectAll}
                        className="text-rose-700 border-rose-200 hover:bg-rose-50 text-[11px] h-7 px-2.5"
                      >
                        <X className="w-3 h-3 mr-1" /> Reject All
                      </Button>
                    </div>
                  )}
                </div>

                {/* Common comment input for Reject All shortcut */}
                {canDecide && totalPending > 1 && (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Optional common comment for 'Reject All'..."
                      value={commonRejectComment}
                      onChange={(e) => setCommonRejectComment(e.target.value)}
                      className="flex-1 px-2.5 py-1 text-[11px] rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                  </div>
                )}

                {/* Segments List with Toggles */}
                <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
                  {(selectedRequest.segments ?? []).map((seg, idx) => {
                    const isPending = !seg.status || seg.status === 'pending';
                    const currentDecision = segmentDecisions[seg.id]?.action;
                    const comment = segmentDecisions[seg.id]?.comment || '';

                    return (
                      <div
                        key={seg.id}
                        className={`p-3 rounded-xl border transition-all ${
                          currentDecision === 'approve'
                            ? 'border-emerald-200 bg-emerald-50/20'
                            : currentDecision === 'reject'
                            ? 'border-rose-200 bg-rose-50/20'
                            : 'border-slate-200 bg-white'
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-800 text-xs">
                                Segment {idx + 1}: {seg.leaveTypeName || (seg.isWfh ? 'Work From Home' : 'Leave')}
                              </span>
                              {seg.status && seg.status !== 'pending' && (
                                <span
                                  className={`px-1.5 py-0.2 rounded text-[10px] font-bold border uppercase ${statusBadgeColor(
                                    seg.status,
                                  )}`}
                                >
                                  {formatStatusLabel(seg.status)}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              {formatCalendarDate(seg.startDate)} to {formatCalendarDate(seg.endDate)} &bull;{' '}
                              <strong className="text-slate-700">{seg.countedDays} days</strong> ({seg.portion})
                            </div>
                          </div>

                          {/* Decision Toggle Buttons */}
                          {canDecide && isPending && (
                            <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                              <button
                                type="button"
                                onClick={() => handleToggleSegmentAction(seg.id, 'approve')}
                                className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                                  currentDecision === 'approve'
                                    ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-500/20'
                                    : 'bg-slate-100 text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 border border-slate-200'
                                }`}
                              >
                                <Check className="w-3.5 h-3.5" /> Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleSegmentAction(seg.id, 'reject')}
                                className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                                  currentDecision === 'reject'
                                    ? 'bg-rose-600 text-white shadow-sm shadow-rose-500/20'
                                    : 'bg-slate-100 text-slate-700 hover:bg-rose-50 hover:text-rose-700 border border-slate-200'
                                }`}
                              >
                                <X className="w-3.5 h-3.5" /> Reject
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Rejection comment input */}
                        {canDecide && isPending && currentDecision === 'reject' && (
                          <div className="mt-2.5 pt-2 border-t border-rose-100">
                            <label className="block text-[11px] font-semibold text-rose-800 mb-1 flex items-center gap-1">
                              <MessageSquare className="w-3 h-3 text-rose-500" />
                              Rejection Reason / Comment <span className="text-rose-600 font-bold">* (required)</span>
                            </label>
                            <input
                              type="text"
                              required
                              value={comment}
                              onChange={(e) => handleSegmentCommentChange(seg.id, e.target.value)}
                              placeholder="Enter required reason for rejecting this segment..."
                              className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-rose-300 bg-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                            />
                            {!comment.trim() && (
                              <p className="text-[10px] text-rose-600 mt-1">
                                Rejection comment cannot be blank.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Bottom Decision Submission Controls */}
              <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-xs">
                  {canDecide ? (
                    undecidedCount > 0 ? (
                      <span className="text-amber-700 font-medium bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200">
                        {undecidedCount} segment{undecidedCount > 1 ? 's' : ''} undecided
                      </span>
                    ) : hasMissingComments ? (
                      <span className="text-rose-700 font-medium bg-rose-50 px-2.5 py-1 rounded-lg border border-rose-200">
                        Comment required for rejected segment
                      </span>
                    ) : (
                      <span className="text-emerald-700 font-medium bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                        All segments decided &bull; Ready to submit
                      </span>
                    )
                  ) : (
                    <span className="text-slate-500 italic">Read-only view</span>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedRequest(null);
                      setSegmentDecisions({});
                    }}
                  >
                    Close
                  </Button>
                  {canDecide && (
                    <Button
                      size="sm"
                      onClick={handleSubmitDecisions}
                      disabled={!canSubmit || decideMutation.isPending}
                      isLoading={decideMutation.isPending}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-sm"
                    >
                      Submit Decision
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
};
