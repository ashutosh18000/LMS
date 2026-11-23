-- CreateEnum
CREATE TYPE "SegmentStatus" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('leave_decided', 'leave_cancelled');

-- AlterEnum
ALTER TYPE "RequestStatus" ADD VALUE 'partially_approved';

-- AlterTable
ALTER TABLE "LeaveSegment" ADD COLUMN     "decidedAt" TIMESTAMPTZ,
ADD COLUMN     "decidedBy" TEXT,
ADD COLUMN     "decisionComment" TEXT,
ADD COLUMN     "status" "SegmentStatus" NOT NULL DEFAULT 'pending';

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "requestId" TEXT,
    "readAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_orgId_createdAt_idx" ON "Notification"("orgId", "createdAt");

-- AddForeignKey
ALTER TABLE "LeaveSegment" ADD CONSTRAINT "LeaveSegment_decidedBy_fkey" FOREIGN KEY ("decidedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "LeaveRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data Backfill: Populate existing segments status and decision metadata from their LeaveRequest
UPDATE "LeaveSegment" ls
SET status = CASE 
  WHEN lr.status = 'approved' THEN 'approved'::"SegmentStatus"
  WHEN lr.status = 'rejected' THEN 'rejected'::"SegmentStatus"
  WHEN lr.status = 'cancelled' THEN 'cancelled'::"SegmentStatus"
  ELSE 'pending'::"SegmentStatus"
END,
"decidedBy" = lr."decidedBy",
"decidedAt" = lr."decidedAt",
"decisionComment" = lr."decisionComment"
FROM "LeaveRequest" lr
WHERE ls."requestId" = lr.id;

-- Data Backfill: Set occupancy to 0 for rejected or cancelled segment days
UPDATE "LeaveSegmentDay" lsd
SET occupancy = 0
FROM "LeaveSegment" ls
WHERE lsd."segmentId" = ls.id AND ls.status IN ('rejected', 'cancelled');
