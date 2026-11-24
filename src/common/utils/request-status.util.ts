import { RequestStatus, SegmentStatus } from '@prisma/client';

/**
 * Derives the overall LeaveRequest status based on the statuses of its segments.
 *
 * Rules:
 * 1. If any segment is pending -> pending
 * 2. If all segments are approved -> approved
 * 3. If there are approved segments and rejected/cancelled segments -> partially_approved
 * 4. If all segments are rejected -> rejected
 * 5. If no approved or pending segments remain, and at least one is cancelled -> cancelled
 */
export function deriveRequestStatus(
  segmentStatuses: (SegmentStatus | string)[],
): RequestStatus {
  if (!segmentStatuses || segmentStatuses.length === 0) {
    return RequestStatus.pending;
  }

  const hasPending = segmentStatuses.some((s) => s === SegmentStatus.pending);
  if (hasPending) {
    return RequestStatus.pending;
  }

  const hasApproved = segmentStatuses.some((s) => s === SegmentStatus.approved);
  const hasRejected = segmentStatuses.some((s) => s === SegmentStatus.rejected);
  const hasCancelled = segmentStatuses.some((s) => s === SegmentStatus.cancelled);

  // All approved
  if (hasApproved && !hasRejected && !hasCancelled) {
    return RequestStatus.approved;
  }

  // Approved + Rejected (or Approved + Cancelled) -> partially_approved
  if (hasApproved && (hasRejected || hasCancelled)) {
    return RequestStatus.partially_approved;
  }

  // All rejected
  if (hasRejected && !hasApproved && !hasCancelled) {
    return RequestStatus.rejected;
  }

  // No approved or pending remain, and at least one is cancelled (e.g. all cancelled, or cancelled + rejected)
  if (!hasApproved && !hasPending && hasCancelled) {
    return RequestStatus.cancelled;
  }

  return RequestStatus.rejected;
}
