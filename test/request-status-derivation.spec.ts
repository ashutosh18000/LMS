import { RequestStatus, SegmentStatus } from '@prisma/client';
import { deriveRequestStatus } from '../src/common/utils/request-status.util';

describe('deriveRequestStatus', () => {
  it('returns pending when empty array', () => {
    expect(deriveRequestStatus([])).toBe(RequestStatus.pending);
  });

  describe('koi pending to pending', () => {
    it('returns pending if all are pending', () => {
      expect(
        deriveRequestStatus([SegmentStatus.pending, SegmentStatus.pending]),
      ).toBe(RequestStatus.pending);
    });

    it('returns pending if mix of pending and approved', () => {
      expect(
        deriveRequestStatus([SegmentStatus.pending, SegmentStatus.approved]),
      ).toBe(RequestStatus.pending);
    });

    it('returns pending if mix of pending and rejected', () => {
      expect(
        deriveRequestStatus([SegmentStatus.pending, SegmentStatus.rejected]),
      ).toBe(RequestStatus.pending);
    });

    it('returns pending if mix of pending, approved, and rejected', () => {
      expect(
        deriveRequestStatus([
          SegmentStatus.pending,
          SegmentStatus.approved,
          SegmentStatus.rejected,
        ]),
      ).toBe(RequestStatus.pending);
    });

    it('returns pending if mix of pending and cancelled', () => {
      expect(
        deriveRequestStatus([SegmentStatus.pending, SegmentStatus.cancelled]),
      ).toBe(RequestStatus.pending);
    });
  });

  describe('nahi to sab approved to approved', () => {
    it('returns approved if single segment is approved', () => {
      expect(deriveRequestStatus([SegmentStatus.approved])).toBe(
        RequestStatus.approved,
      );
    });

    it('returns approved if all multiple segments are approved', () => {
      expect(
        deriveRequestStatus([
          SegmentStatus.approved,
          SegmentStatus.approved,
          SegmentStatus.approved,
        ]),
      ).toBe(RequestStatus.approved);
    });
  });

  describe('approved + rejected to partially_approved', () => {
    it('returns partially_approved if 1 approved and 1 rejected', () => {
      expect(
        deriveRequestStatus([SegmentStatus.approved, SegmentStatus.rejected]),
      ).toBe(RequestStatus.partially_approved);
    });

    it('returns partially_approved if multiple approved and 1 rejected', () => {
      expect(
        deriveRequestStatus([
          SegmentStatus.approved,
          SegmentStatus.approved,
          SegmentStatus.rejected,
        ]),
      ).toBe(RequestStatus.partially_approved);
    });

    it('returns partially_approved if 1 approved and multiple rejected', () => {
      expect(
        deriveRequestStatus([
          SegmentStatus.approved,
          SegmentStatus.rejected,
          SegmentStatus.rejected,
        ]),
      ).toBe(RequestStatus.partially_approved);
    });

    it('returns partially_approved if approved + rejected + cancelled', () => {
      expect(
        deriveRequestStatus([
          SegmentStatus.approved,
          SegmentStatus.rejected,
          SegmentStatus.cancelled,
        ]),
      ).toBe(RequestStatus.partially_approved);
    });

    it('returns partially_approved if approved + cancelled', () => {
      expect(
        deriveRequestStatus([SegmentStatus.approved, SegmentStatus.cancelled]),
      ).toBe(RequestStatus.partially_approved);
    });
  });

  describe('sab rejected to rejected', () => {
    it('returns rejected if single segment is rejected', () => {
      expect(deriveRequestStatus([SegmentStatus.rejected])).toBe(
        RequestStatus.rejected,
      );
    });

    it('returns rejected if all multiple segments are rejected', () => {
      expect(
        deriveRequestStatus([SegmentStatus.rejected, SegmentStatus.rejected]),
      ).toBe(RequestStatus.rejected);
    });
  });

  describe('koi approved ya pending na bache aur kuch cancelled ho to cancelled', () => {
    it('returns cancelled if all segments are cancelled', () => {
      expect(
        deriveRequestStatus([
          SegmentStatus.cancelled,
          SegmentStatus.cancelled,
        ]),
      ).toBe(RequestStatus.cancelled);
    });

    it('returns cancelled if mix of cancelled and rejected (0 approved, 0 pending)', () => {
      expect(
        deriveRequestStatus([
          SegmentStatus.cancelled,
          SegmentStatus.rejected,
        ]),
      ).toBe(RequestStatus.cancelled);
    });
  });
});
