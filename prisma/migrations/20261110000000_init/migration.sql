-- =============================================================================
-- Initial Migration: Multi-tenant Leave Management System
-- =============================================================================

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('root', 'org_owner', 'hr_admin', 'manager', 'staff');

-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

-- CreateEnum
CREATE TYPE "Portion" AS ENUM ('full', 'first_half', 'second_half');

-- CreateEnum
CREATE TYPE "SaturdayMode" AS ENUM ('off', 'half', 'full', 'alternate');

-- CreateEnum
CREATE TYPE "SkipReason" AS ENUM ('none', 'weekly_off', 'holiday');

-- CreateTable: Organization
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "OrgStatus" NOT NULL DEFAULT 'active',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "financialYearStartMonth" INTEGER NOT NULL DEFAULT 4,
    "workingDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "backdateAllowedDays" INTEGER NOT NULL DEFAULT 7,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable: User
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "managerId" TEXT,
    "department" TEXT,
    "joiningDate" DATE,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable: RefreshToken
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AuditLog
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "actorId" TEXT NOT NULL,
    "targetUserId" TEXT,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable: WorkScheduleTemplate
CREATE TABLE "WorkScheduleTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "saturdayMode" "SaturdayMode" NOT NULL,
    "alternateOffWeeks" INTEGER[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "WorkScheduleTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable: EmployeeSchedule
CREATE TABLE "EmployeeSchedule" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "EmployeeSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable: LeaveType
CREATE TABLE "LeaveType" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "paid" BOOLEAN NOT NULL,
    "daysPerYear" DECIMAL(5,1),
    "monthlyLimit" DECIMAL(5,1),
    "deductsBalance" BOOLEAN NOT NULL,
    "isWfh" BOOLEAN NOT NULL DEFAULT false,
    "halfDayAllowed" BOOLEAN NOT NULL,
    "minNoticeDays" INTEGER NOT NULL DEFAULT 0,
    "carryForwardMax" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "LeaveType_pkey" PRIMARY KEY ("id")
);

-- CreateTable: LeaveBalance
CREATE TABLE "LeaveBalance" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "allocated" DECIMAL(5,1) NOT NULL,
    "used" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "pending" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "LeaveBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable: BalanceAdjustment
CREATE TABLE "BalanceAdjustment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "balanceId" TEXT NOT NULL,
    "delta" DECIMAL(5,1) NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BalanceAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CarryForwardRun
CREATE TABLE "CarryForwardRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "fromYear" INTEGER NOT NULL,
    "runBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarryForwardRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Holiday
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable: LeaveRequest
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'pending',
    "spanDays" INTEGER NOT NULL,
    "countedDays" DECIMAL(5,1) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMPTZ,
    "decisionComment" TEXT,
    "cancelledAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable: LeaveSegment
CREATE TABLE "LeaveSegment" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "portion" "Portion" NOT NULL DEFAULT 'full',
    "countedDays" DECIMAL(5,1) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "LeaveSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable: LeaveSegmentDay
CREATE TABLE "LeaveSegmentDay" (
    "id" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "occupancy" DECIMAL(5,1) NOT NULL,
    "countedWeight" DECIMAL(5,1) NOT NULL,
    "skipReason" "SkipReason" NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveSegmentDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_orgId_idx" ON "User"("orgId");

-- CreateIndex
CREATE INDEX "User_managerId_idx" ON "User"("managerId");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_orgId_createdAt_idx" ON "AuditLog"("orgId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkScheduleTemplate_orgId_name_key" ON "WorkScheduleTemplate"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeSchedule_userId_effectiveFrom_key" ON "EmployeeSchedule"("userId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveType_orgId_name_key" ON "LeaveType"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveBalance_userId_leaveTypeId_year_key" ON "LeaveBalance"("userId", "leaveTypeId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "CarryForwardRun_orgId_fromYear_key" ON "CarryForwardRun"("orgId", "fromYear");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_orgId_date_key" ON "Holiday"("orgId", "date");

-- CreateIndex
CREATE INDEX "LeaveRequest_orgId_status_idx" ON "LeaveRequest"("orgId", "status");

-- CreateIndex
CREATE INDEX "LeaveRequest_userId_status_idx" ON "LeaveRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "LeaveSegment_userId_startDate_endDate_idx" ON "LeaveSegment"("userId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "LeaveSegmentDay_userId_date_idx" ON "LeaveSegmentDay"("userId", "date");

-- CreateIndex
CREATE INDEX "LeaveSegmentDay_orgId_date_idx" ON "LeaveSegmentDay"("orgId", "date");

-- CreateIndex
CREATE INDEX "LeaveSegmentDay_leaveTypeId_userId_date_idx" ON "LeaveSegmentDay"("leaveTypeId", "userId", "date");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkScheduleTemplate" ADD CONSTRAINT "WorkScheduleTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeSchedule" ADD CONSTRAINT "EmployeeSchedule_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeSchedule" ADD CONSTRAINT "EmployeeSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeSchedule" ADD CONSTRAINT "EmployeeSchedule_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WorkScheduleTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveType" ADD CONSTRAINT "LeaveType_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveBalance" ADD CONSTRAINT "LeaveBalance_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveBalance" ADD CONSTRAINT "LeaveBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveBalance" ADD CONSTRAINT "LeaveBalance_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceAdjustment" ADD CONSTRAINT "BalanceAdjustment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceAdjustment" ADD CONSTRAINT "BalanceAdjustment_balanceId_fkey" FOREIGN KEY ("balanceId") REFERENCES "LeaveBalance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceAdjustment" ADD CONSTRAINT "BalanceAdjustment_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarryForwardRun" ADD CONSTRAINT "CarryForwardRun_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarryForwardRun" ADD CONSTRAINT "CarryForwardRun_runBy_fkey" FOREIGN KEY ("runBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_decidedBy_fkey" FOREIGN KEY ("decidedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveSegment" ADD CONSTRAINT "LeaveSegment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "LeaveRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveSegment" ADD CONSTRAINT "LeaveSegment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveSegment" ADD CONSTRAINT "LeaveSegment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveSegment" ADD CONSTRAINT "LeaveSegment_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveSegmentDay" ADD CONSTRAINT "LeaveSegmentDay_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "LeaveSegment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveSegmentDay" ADD CONSTRAINT "LeaveSegmentDay_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "LeaveRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveSegmentDay" ADD CONSTRAINT "LeaveSegmentDay_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveSegmentDay" ADD CONSTRAINT "LeaveSegmentDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveSegmentDay" ADD CONSTRAINT "LeaveSegmentDay_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- RAW SQL CONSTRAINTS & PARTIAL UNIQUE INDEXES
-- These enforce platform-level business invariants not directly expressible
-- in native Prisma schema syntax.
-- =============================================================================

-- 1. Enforces that an organization can have at most ONE active owner ('org_owner').
-- Inactive/suspended owners are excluded from this index, allowing smooth ownership transfers.
CREATE UNIQUE INDEX uq_one_active_owner_per_org ON "User"("orgId") WHERE role = 'org_owner' AND active = true;

-- 2. Enforces that across the entire platform, there can only ever be ONE user with the 'root' role.
-- Prevents unauthorized creation of multiple super-administrator accounts.
CREATE UNIQUE INDEX uq_single_root ON "User"(role) WHERE role = 'root';

-- 3. Enforces multi-tenancy scoping rules:
-- - The platform super-admin ('root') MUST NOT be associated with any specific organization (orgId IS NULL).
-- - All tenant-level users ('org_owner', 'hr_admin', 'manager', 'staff') MUST belong to an organization (orgId IS NOT NULL).
ALTER TABLE "User" ADD CONSTRAINT chk_user_root_org CHECK (
  (role = 'root' AND "orgId" IS NULL) OR
  (role <> 'root' AND "orgId" IS NOT NULL)
);

-- 4. Enforces chronological validity: A leave segment's start date must be before or equal to its end date.
ALTER TABLE "LeaveSegment" ADD CONSTRAINT chk_leave_segment_dates CHECK ("startDate" <= "endDate");

-- 5. Enforces non-negative values on LeaveBalance metrics (allocated, used, pending).
ALTER TABLE "LeaveBalance" ADD CONSTRAINT chk_leave_balance_non_negative CHECK (
  "allocated" >= 0 AND "used" >= 0 AND "pending" >= 0
);

-- 6. Enforces non-negative counted days on LeaveRequest.
ALTER TABLE "LeaveRequest" ADD CONSTRAINT chk_leave_request_counted_days_non_negative CHECK (
  "countedDays" >= 0
);

-- 7. Enforces non-negative counted days on LeaveSegment.
ALTER TABLE "LeaveSegment" ADD CONSTRAINT chk_leave_segment_counted_days_non_negative CHECK (
  "countedDays" >= 0
);

-- 8. Enforces non-negative occupancy and counted weight on LeaveSegmentDay breakdowns.
ALTER TABLE "LeaveSegmentDay" ADD CONSTRAINT chk_leave_segment_day_non_negative CHECK (
  "occupancy" >= 0 AND "countedWeight" >= 0
);

-- 9. Enforces non-negative quota configurations on LeaveType.
ALTER TABLE "LeaveType" ADD CONSTRAINT chk_leave_type_non_negative CHECK (
  ("daysPerYear" IS NULL OR "daysPerYear" >= 0) AND
  ("monthlyLimit" IS NULL OR "monthlyLimit" >= 0) AND
  "carryForwardMax" >= 0
);
