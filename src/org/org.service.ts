import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from '../auth/password.service';
import { AuditAction, AuditService } from '../audit/audit.service';
import { BalancesService } from '../balances/balances.service';
import { LeaveRequestsService } from '../leave-requests/leave-requests.service';
import { UpdateOrgSettingsDto } from './dto/update-settings.dto';
import { CreateHrAdminDto } from './dto/create-hr-admin.dto';
import { PromoteHrAdminDto } from './dto/promote-hr-admin.dto';
import { DemoteHrAdminDto } from './dto/demote-hr-admin.dto';
import { DeactivateHrAdminDto } from './dto/deactivate-hr-admin.dto';
import { QueryHrAdminsDto } from './dto/query-hr-admins.dto';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto';
import { QueryOrgAuditLogsDto } from './dto/query-audit-logs.dto';
import { PaginatedResult } from '../common/dto/pagination.dto';

@Injectable()
export class OrgService {
  private readonly logger = new Logger(OrgService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly auditService: AuditService,
    private readonly balancesService: BalancesService,
    private readonly leaveRequestsService: LeaveRequestsService,
  ) {}

  /**
   * 1. GET /org/settings
   */
  async getSettings(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    return {
      id: org.id,
      name: org.name,
      status: org.status,
      timezone: org.timezone,
      financialYearStartMonth: org.financialYearStartMonth,
      workingDays: org.workingDays,
      backdateAllowedDays: org.backdateAllowedDays,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
    };
  }

  /**
   * 1. PATCH /org/settings
   */
  async updateSettings(
    ownerId: string,
    orgId: string,
    dto: UpdateOrgSettingsDto,
  ) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    // Validate IANA timezone
    if (dto.timezone) {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: dto.timezone });
      } catch {
        throw new BadRequestException(`Invalid IANA timezone: ${dto.timezone}`);
      }
    }

    // Validate workingDays uniqueness
    if (dto.workingDays) {
      const uniqueDays = new Set(dto.workingDays);
      if (uniqueDays.size !== dto.workingDays.length) {
        throw new BadRequestException('Working days must be unique integers');
      }
    }

    // Disallow changing financialYearStartMonth if any LeaveBalance exists for the organization
    if (
      dto.financialYearStartMonth !== undefined &&
      dto.financialYearStartMonth !== org.financialYearStartMonth
    ) {
      const balanceCount = await this.prisma.leaveBalance.count({
        where: { orgId },
      });
      if (balanceCount > 0) {
        throw new ConflictException(
          'Balances maujood hain, financial year start nahi badal sakte',
        );
      }
    }

    const beforeSettings = {
      name: org.name,
      timezone: org.timezone,
      financialYearStartMonth: org.financialYearStartMonth,
      workingDays: org.workingDays,
      backdateAllowedDays: org.backdateAllowedDays,
    };

    const updated = await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.timezone !== undefined && { timezone: dto.timezone }),
        ...(dto.financialYearStartMonth !== undefined && {
          financialYearStartMonth: dto.financialYearStartMonth,
        }),
        ...(dto.workingDays !== undefined && {
          workingDays: dto.workingDays,
        }),
        ...(dto.backdateAllowedDays !== undefined && {
          backdateAllowedDays: dto.backdateAllowedDays,
        }),
      },
    });

    const afterSettings = {
      name: updated.name,
      timezone: updated.timezone,
      financialYearStartMonth: updated.financialYearStartMonth,
      workingDays: updated.workingDays,
      backdateAllowedDays: updated.backdateAllowedDays,
    };

    await this.auditService.log({
      orgId,
      actorId: ownerId,
      action: AuditAction.ORG_SETTINGS_UPDATED,
      reason: 'Organization settings updated by owner',
      metadata: {
        before: beforeSettings,
        after: afterSettings,
      },
    });

    return {
      message: 'Settings updated successfully',
      settings: afterSettings,
    };
  }

  /**
   * 2. POST /org/hr-admins
   */
  async createHrAdmin(ownerId: string, orgId: string, dto: CreateHrAdminDto) {
    const email = dto.email.toLowerCase().trim();

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existingUser) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await this.passwordService.hash(dto.tempPassword);

    const hrAdmin = await this.prisma.user.create({
      data: {
        orgId,
        email,
        name: dto.name,
        passwordHash,
        role: Role.hr_admin,
        mustChangePassword: true,
        active: true,
      },
    });

    await this.auditService.log({
      orgId,
      actorId: ownerId,
      targetUserId: hrAdmin.id,
      action: AuditAction.HR_ADMIN_CREATED,
      reason: 'HR Admin created by organization owner',
      metadata: { hrEmail: hrAdmin.email, hrName: hrAdmin.name },
    });

    // Hook: Allocate initial balances for HR Admin (prorated)
    try {
      await this.balancesService.allocateForUser(hrAdmin.id);
    } catch (err: any) {
      this.logger.error(
        `Failed to allocate initial balances for HR admin ${hrAdmin.id}: ${err.message}`,
      );
    }

    return {
      id: hrAdmin.id,
      name: hrAdmin.name,
      email: hrAdmin.email,
      role: hrAdmin.role,
      orgId: hrAdmin.orgId,
      active: hrAdmin.active,
      mustChangePassword: hrAdmin.mustChangePassword,
    };
  }

  /**
   * 3. POST /org/hr-admins/promote
   * Promotes active staff or manager to HR Admin.
   * If user is a manager with direct reports, blocks promotion with 409 Conflict.
   */
  async promoteHrAdmin(
    ownerId: string,
    orgId: string,
    dto: PromoteHrAdminDto,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: dto.userId, orgId },
    });

    if (!user) {
      throw new NotFoundException('User not found in this organization');
    }

    if (!user.active) {
      throw new BadRequestException('User is inactive');
    }

    if (user.role === Role.hr_admin) {
      throw new BadRequestException('User is already an HR Admin');
    }

    if (user.role !== Role.staff && user.role !== Role.manager) {
      throw new BadRequestException(
        'Only active staff or manager can be promoted to HR Admin',
      );
    }

    // Check direct reports if current role is manager
    if (user.role === Role.manager) {
      const reportsCount = await this.prisma.user.count({
        where: { managerId: user.id, orgId },
      });

      if (reportsCount > 0) {
        throw new ConflictException(
          `Manager has ${reportsCount} direct report(s). Reassign reports before promoting to HR admin.`,
        );
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.user.update({
        where: { id: user.id },
        data: { role: Role.hr_admin },
      });

      await tx.refreshToken.deleteMany({
        where: { userId: user.id },
      });

      return res;
    });

    await this.auditService.log({
      orgId,
      actorId: ownerId,
      targetUserId: user.id,
      action: AuditAction.HR_ADMIN_PROMOTED,
      reason: 'User promoted to HR Admin',
      metadata: { previousRole: user.role, newRole: Role.hr_admin },
    });

    return {
      message: 'User promoted to HR Admin successfully',
      user: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        role: updated.role,
      },
    };
  }

  /**
   * 4. POST /org/hr-admins/:id/demote
   */
  async demoteHrAdmin(
    ownerId: string,
    orgId: string,
    targetUserId: string,
    dto: DemoteHrAdminDto,
  ) {
    if (targetUserId === ownerId) {
      throw new BadRequestException('Owner cannot demote himself');
    }

    const user = await this.prisma.user.findFirst({
      where: { id: targetUserId, orgId },
    });

    if (!user) {
      throw new NotFoundException('User not found in this organization');
    }

    if (user.role !== Role.hr_admin) {
      throw new BadRequestException('Only HR Admins can be demoted');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.user.update({
        where: { id: targetUserId },
        data: { role: dto.newRole },
      });

      await tx.refreshToken.deleteMany({
        where: { userId: targetUserId },
      });

      return res;
    });

    await this.auditService.log({
      orgId,
      actorId: ownerId,
      targetUserId,
      action: AuditAction.HR_ADMIN_DEMOTED,
      reason: `HR Admin demoted to ${dto.newRole}`,
      metadata: { previousRole: Role.hr_admin, newRole: dto.newRole },
    });

    return {
      message: `HR Admin demoted to ${dto.newRole} successfully`,
      user: {
        id: updated.id,
        name: updated.name,
        role: updated.role,
      },
    };
  }

  /**
   * 5. PATCH /org/hr-admins/:id/deactivate
   */
  async deactivateHrAdmin(
    ownerId: string,
    orgId: string,
    targetUserId: string,
    dto: DeactivateHrAdminDto,
  ) {
    if (targetUserId === ownerId) {
      throw new BadRequestException('Owner cannot deactivate himself');
    }

    const user = await this.prisma.user.findFirst({
      where: { id: targetUserId, orgId },
    });

    if (!user) {
      throw new NotFoundException('User not found in this organization');
    }

    if (user.role !== Role.hr_admin) {
      throw new BadRequestException(
        'Owner (org_owner) or non-HR users cannot be deactivated via this endpoint',
      );
    }

    if (!user.active) {
      return {
        message: 'HR Admin is already inactive',
        user: { id: user.id, name: user.name, active: false },
      };
    }

    // Check if this is the last active HR admin
    const activeHrCount = await this.prisma.user.count({
      where: { orgId, role: Role.hr_admin, active: true },
    });

    if (activeHrCount <= 1 && dto?.confirmLastHr !== true) {
      throw new ConflictException(
        'Aakhri active hr_admin hai, confirm karein',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.user.update({
        where: { id: targetUserId },
        data: { active: false },
      });

      await tx.refreshToken.deleteMany({
        where: { userId: targetUserId },
      });

      // Automatically cancel any pending leave requests and release balances
      await this.leaveRequestsService.cancelUserPendingRequestsOnDeactivation(
        tx,
        orgId,
        targetUserId,
        ownerId,
      );

      return res;
    });

    await this.auditService.log({
      orgId,
      actorId: ownerId,
      targetUserId,
      action: AuditAction.HR_ADMIN_DEACTIVATED,
      reason: 'HR Admin deactivated',
    });

    return {
      message: 'HR Admin deactivated successfully',
      user: {
        id: updated.id,
        name: updated.name,
        active: updated.active,
      },
    };
  }

  /**
   * 5. PATCH /org/hr-admins/:id/reactivate
   */
  async reactivateHrAdmin(
    ownerId: string,
    orgId: string,
    targetUserId: string,
  ) {
    if (targetUserId === ownerId) {
      throw new BadRequestException('Owner cannot reactivate himself');
    }

    const user = await this.prisma.user.findFirst({
      where: { id: targetUserId, orgId },
    });

    if (!user) {
      throw new NotFoundException('User not found in this organization');
    }

    if (user.role !== Role.hr_admin) {
      throw new BadRequestException(
        'Owner (org_owner) or non-HR users cannot be reactivated via this endpoint',
      );
    }

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { active: true },
    });

    await this.auditService.log({
      orgId,
      actorId: ownerId,
      targetUserId,
      action: AuditAction.HR_ADMIN_REACTIVATED,
      reason: 'HR Admin reactivated',
    });

    return {
      message: 'HR Admin reactivated successfully',
      user: {
        id: updated.id,
        name: updated.name,
        active: updated.active,
      },
    };
  }

  /**
   * 6. GET /org/hr-admins
   */
  async getHrAdmins(
    orgId: string,
    query: QueryHrAdminsDto,
  ): Promise<PaginatedResult<any>> {
    const where: Prisma.UserWhereInput = {
      orgId,
      role: Role.hr_admin,
      ...(query.active !== undefined && { active: query.active }),
    };

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          active: true,
          department: true,
          joiningDate: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    return {
      items: users,
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * 7. POST /org/transfer-ownership
   * Transfers ownership to another active member of the org.
   * Strictly verifies current owner password first.
   * Transaction order: old owner becomes hr_admin FIRST, then new user becomes org_owner.
   */
  async transferOwnership(
    ownerId: string,
    orgId: string,
    dto: TransferOwnershipDto,
  ) {
    const currentOwner = await this.prisma.user.findUnique({
      where: { id: ownerId },
    });

    if (!currentOwner) {
      throw new NotFoundException('Current owner not found');
    }

    // Verify current owner password
    const isPasswordValid = await this.passwordService.compare(
      dto.currentPassword,
      currentOwner.passwordHash,
    );
    if (!isPasswordValid) {
      throw new ForbiddenException('Invalid password');
    }

    if (dto.newOwnerUserId === ownerId) {
      throw new BadRequestException('Cannot transfer ownership to yourself');
    }

    const newOwnerCandidate = await this.prisma.user.findFirst({
      where: { id: dto.newOwnerUserId, orgId, active: true },
    });

    if (!newOwnerCandidate) {
      throw new BadRequestException(
        'Target user must be an active member of this organization',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Step 1: Demote current owner to hr_admin (frees unique index slot)
      await tx.user.update({
        where: { id: ownerId },
        data: { role: Role.hr_admin },
      });

      // Step 2: Promote new user to org_owner
      await tx.user.update({
        where: { id: newOwnerCandidate.id },
        data: { role: Role.org_owner },
      });

      // Step 3: Revoke refresh tokens of both users
      await tx.refreshToken.deleteMany({
        where: { userId: { in: [ownerId, newOwnerCandidate.id] } },
      });
    });

    await this.auditService.log({
      orgId,
      actorId: ownerId,
      targetUserId: newOwnerCandidate.id,
      action: AuditAction.OWNERSHIP_TRANSFERRED,
      reason: 'Ownership transferred by organization owner',
      metadata: {
        previousOwnerId: ownerId,
        newOwnerId: newOwnerCandidate.id,
      },
    });

    return {
      message: 'Ownership transferred successfully',
      previousOwnerId: ownerId,
      newOwnerId: newOwnerCandidate.id,
    };
  }

  /**
   * 8. GET /org/audit-logs
   * Strictly reads logs belonging to the caller's organization.
   * Root operations affecting this org are also included.
   */
  async getAuditLogs(
    orgId: string,
    query: QueryOrgAuditLogsDto,
  ): Promise<PaginatedResult<any>> {
    const where: Prisma.AuditLogWhereInput = {
      orgId,
      ...(query.action && { action: query.action }),
      ...(query.actorId && { actorId: query.actorId }),
      ...((query.from || query.to) && {
        createdAt: {
          ...(query.from && { gte: new Date(query.from) }),
          ...(query.to && { lte: new Date(query.to) }),
        },
      }),
    };

    const [total, logs] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { createdAt: 'desc' },
        include: {
          actor: {
            select: { id: true, name: true, email: true, role: true },
          },
          targetUser: {
            select: { id: true, name: true, email: true, role: true },
          },
        },
      }),
    ]);

    return {
      items: logs,
      total,
      page: query.page,
      limit: query.limit,
    };
  }
}
