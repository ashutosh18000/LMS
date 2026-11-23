import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export enum AuditAction {
  USER_PASSWORD_CHANGE = 'USER_PASSWORD_CHANGE',
  ORG_CREATED = 'ORG_CREATED',
  ORG_SUSPENDED = 'ORG_SUSPENDED',
  ORG_ACTIVATED = 'ORG_ACTIVATED',
  OWNER_REPLACED = 'OWNER_REPLACED',
  OWNER_PASSWORD_RESET = 'OWNER_PASSWORD_RESET',
  ORG_SETTINGS_UPDATED = 'ORG_SETTINGS_UPDATED',
  HR_ADMIN_CREATED = 'HR_ADMIN_CREATED',
  HR_ADMIN_PROMOTED = 'HR_ADMIN_PROMOTED',
  HR_ADMIN_DEMOTED = 'HR_ADMIN_DEMOTED',
  HR_ADMIN_DEACTIVATED = 'HR_ADMIN_DEACTIVATED',
  HR_ADMIN_REACTIVATED = 'HR_ADMIN_REACTIVATED',
  OWNERSHIP_TRANSFERRED = 'OWNERSHIP_TRANSFERRED',

  // HR Setup: Users
  USER_CREATED = 'USER_CREATED',
  USER_UPDATED = 'USER_UPDATED',
  USER_DEACTIVATED = 'USER_DEACTIVATED',
  USER_REACTIVATED = 'USER_REACTIVATED',
  USER_PASSWORD_RESET = 'USER_PASSWORD_RESET',
  MANAGER_REASSIGNED = 'MANAGER_REASSIGNED',

  // HR Setup: Schedules
  SCHEDULE_TEMPLATE_CREATED = 'SCHEDULE_TEMPLATE_CREATED',
  SCHEDULE_TEMPLATE_UPDATED = 'SCHEDULE_TEMPLATE_UPDATED',
  SCHEDULE_TEMPLATE_DEACTIVATED = 'SCHEDULE_TEMPLATE_DEACTIVATED',
  SCHEDULE_TEMPLATE_REACTIVATED = 'SCHEDULE_TEMPLATE_REACTIVATED',
  SCHEDULE_ASSIGNED = 'SCHEDULE_ASSIGNED',

  // HR Setup: Leave Types
  LEAVE_TYPE_CREATED = 'LEAVE_TYPE_CREATED',
  LEAVE_TYPE_UPDATED = 'LEAVE_TYPE_UPDATED',
  LEAVE_TYPE_DEACTIVATED = 'LEAVE_TYPE_DEACTIVATED',
  LEAVE_TYPE_REACTIVATED = 'LEAVE_TYPE_REACTIVATED',

  // HR Setup: Holidays
  HOLIDAY_CREATED = 'HOLIDAY_CREATED',
  HOLIDAY_UPDATED = 'HOLIDAY_UPDATED',
  HOLIDAY_DEACTIVATED = 'HOLIDAY_DEACTIVATED',
  HOLIDAY_REACTIVATED = 'HOLIDAY_REACTIVATED',

  // Balances
  BALANCES_ALLOCATED = 'BALANCES_ALLOCATED',
  BALANCE_ADJUSTED = 'BALANCE_ADJUSTED',
  CARRY_FORWARD_RUN = 'CARRY_FORWARD_RUN',

  // Approvals & Leave Requests
  LEAVE_APPROVED = 'LEAVE_APPROVED',
  LEAVE_REJECTED = 'LEAVE_REJECTED',
  LEAVE_APPLIED_ON_BEHALF = 'LEAVE_APPLIED_ON_BEHALF',
  LEAVE_CANCELLED_BY_HR = 'LEAVE_CANCELLED_BY_HR',
  LEAVE_AUTO_CANCELLED = 'LEAVE_AUTO_CANCELLED',
}

export interface CreateAuditLogDto {
  orgId?: string | null;
  actorId: string;
  targetUserId?: string | null;
  action: AuditAction | string;
  reason?: string | null;
  metadata?: any;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records an immutable audit log entry.
   * Audit logs cannot be updated or deleted.
   */
  async log(
    data: CreateAuditLogDto,
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    return db.auditLog.create({
      data: {
        orgId: data.orgId ?? null,
        actorId: data.actorId,
        targetUserId: data.targetUserId ?? null,
        action: data.action,
        reason: data.reason ?? null,
        metadata: data.metadata ?? undefined,
      },
    });
  }
}
