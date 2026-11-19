import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditAction, AuditService } from '../audit/audit.service';
import { CreateLeaveTypeDto } from './dto/create-leave-type.dto';
import { UpdateLeaveTypeDto } from './dto/update-leave-type.dto';

@Injectable()
export class LeaveTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  private validateRules(data: {
    isWfh: boolean;
    deductsBalance: boolean;
    daysPerYear?: number | null;
    carryForwardMax?: number | null;
  }) {
    // 1. isWfh true -> deductsBalance must be false and daysPerYear must be null
    if (data.isWfh) {
      if (data.deductsBalance) {
        throw new BadRequestException(
          'WFH leave types cannot deduct balance (deductsBalance must be false)',
        );
      }
      if (data.daysPerYear != null) {
        throw new BadRequestException(
          'WFH leave types cannot have an annual quota (daysPerYear must be null)',
        );
      }
      if (data.carryForwardMax && data.carryForwardMax > 0) {
        throw new BadRequestException(
          'WFH leave types cannot have carry forward (carryForwardMax must be 0)',
        );
      }
    }

    // 2. deductsBalance true -> daysPerYear is required
    if (data.deductsBalance) {
      if (data.daysPerYear == null) {
        throw new BadRequestException(
          'daysPerYear is required when deductsBalance is true',
        );
      }
    }

    // 3. carryForwardMax cannot exceed daysPerYear
    if (
      data.carryForwardMax != null &&
      data.daysPerYear != null &&
      data.carryForwardMax > data.daysPerYear
    ) {
      throw new BadRequestException(
        'carryForwardMax cannot exceed daysPerYear',
      );
    }
  }

  /**
   * 1. POST /leave-types
   */
  async createLeaveType(
    creatorId: string,
    orgId: string,
    dto: CreateLeaveTypeDto,
  ) {
    this.validateRules({
      isWfh: dto.isWfh,
      deductsBalance: dto.deductsBalance,
      daysPerYear: dto.daysPerYear,
      carryForwardMax: dto.carryForwardMax,
    });

    const existing = await this.prisma.leaveType.findUnique({
      where: {
        orgId_name: {
          orgId,
          name: dto.name,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        'A leave type with this name already exists in this organization',
      );
    }

    const leaveType = await this.prisma.leaveType.create({
      data: {
        orgId,
        name: dto.name,
        paid: dto.paid,
        daysPerYear: dto.daysPerYear ?? null,
        monthlyLimit: dto.monthlyLimit ?? null,
        deductsBalance: dto.deductsBalance,
        isWfh: dto.isWfh,
        halfDayAllowed: dto.halfDayAllowed,
        minNoticeDays: dto.minNoticeDays ?? 0,
        carryForwardMax: dto.carryForwardMax ?? 0,
        active: true,
      },
    });

    await this.auditService.log({
      orgId,
      actorId: creatorId,
      action: AuditAction.LEAVE_TYPE_CREATED,
      reason: 'Leave type created by HR',
      metadata: { leaveTypeId: leaveType.id, name: leaveType.name },
    });

    return leaveType;
  }

  /**
   * 2. GET /leave-types
   * Open to all logged-in users.
   * Non-HR roles receive sanitized projection; HR roles receive full entity.
   */
  async getLeaveTypes(
    orgId: string,
    userRole: Role,
    includeInactive?: boolean,
  ) {
    const isHrOrAbove =
      userRole === Role.hr_admin ||
      userRole === Role.org_owner ||
      userRole === Role.root;

    const where: any = { orgId };
    if (!isHrOrAbove || !includeInactive) {
      where.active = true;
    }

    if (!isHrOrAbove) {
      // Non-HR users: return only essential fields
      return this.prisma.leaveType.findMany({
        where,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          isWfh: true,
          deductsBalance: true,
          halfDayAllowed: true,
          minNoticeDays: true,
        },
      });
    }

    // HR users: return full entity
    return this.prisma.leaveType.findMany({
      where,
      orderBy: { name: 'asc' },
    });
  }

  /**
   * 2b. GET /leave-types/:id
   */
  async getLeaveTypeById(orgId: string, id: string, userRole: Role) {
    const leaveType = await this.prisma.leaveType.findFirst({
      where: { id, orgId },
    });

    if (!leaveType) {
      throw new NotFoundException('Leave type not found');
    }

    const isHrOrAbove =
      userRole === Role.hr_admin ||
      userRole === Role.org_owner ||
      userRole === Role.root;

    if (!isHrOrAbove) {
      if (!leaveType.active) {
        throw new NotFoundException('Leave type not found');
      }
      return {
        id: leaveType.id,
        name: leaveType.name,
        isWfh: leaveType.isWfh,
        deductsBalance: leaveType.deductsBalance,
        halfDayAllowed: leaveType.halfDayAllowed,
        minNoticeDays: leaveType.minNoticeDays,
      };
    }

    return leaveType;
  }

  /**
   * 3. PATCH /leave-types/:id
   */
  async updateLeaveType(
    actorId: string,
    orgId: string,
    id: string,
    dto: UpdateLeaveTypeDto,
  ) {
    const leaveType = await this.prisma.leaveType.findFirst({
      where: { id, orgId },
    });

    if (!leaveType) {
      throw new NotFoundException('Leave type not found');
    }

    // isWfh cannot be changed after creation
    if (dto.isWfh !== undefined && dto.isWfh !== leaveType.isWfh) {
      throw new BadRequestException('isWfh cannot be modified after creation');
    }

    if (dto.name && dto.name !== leaveType.name) {
      const existing = await this.prisma.leaveType.findUnique({
        where: { orgId_name: { orgId, name: dto.name } },
      });
      if (existing) {
        throw new ConflictException(
          'A leave type with this name already exists in this organization',
        );
      }
    }

    const targetDaysPerYear =
      dto.daysPerYear !== undefined
        ? dto.daysPerYear
        : leaveType.daysPerYear ? Number(leaveType.daysPerYear) : null;
    const targetCarryForwardMax =
      dto.carryForwardMax !== undefined
        ? dto.carryForwardMax
        : Number(leaveType.carryForwardMax);
    const targetDeductsBalance =
      dto.deductsBalance !== undefined
        ? dto.deductsBalance
        : leaveType.deductsBalance;

    this.validateRules({
      isWfh: leaveType.isWfh,
      deductsBalance: targetDeductsBalance,
      daysPerYear: targetDaysPerYear,
      carryForwardMax: targetCarryForwardMax,
    });

    const updated = await this.prisma.leaveType.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.paid !== undefined && { paid: dto.paid }),
        ...(dto.daysPerYear !== undefined && { daysPerYear: dto.daysPerYear }),
        ...(dto.monthlyLimit !== undefined && { monthlyLimit: dto.monthlyLimit }),
        ...(dto.deductsBalance !== undefined && {
          deductsBalance: dto.deductsBalance,
        }),
        ...(dto.halfDayAllowed !== undefined && {
          halfDayAllowed: dto.halfDayAllowed,
        }),
        ...(dto.minNoticeDays !== undefined && {
          minNoticeDays: dto.minNoticeDays,
        }),
        ...(dto.carryForwardMax !== undefined && {
          carryForwardMax: dto.carryForwardMax,
        }),
      },
    });

    await this.auditService.log({
      orgId,
      actorId,
      action: AuditAction.LEAVE_TYPE_UPDATED,
      reason: 'Leave type updated by HR',
      metadata: { leaveTypeId: id, updatedFields: dto },
    });

    return updated;
  }

  /**
   * 4. PATCH /leave-types/:id/deactivate
   */
  async deactivateLeaveType(actorId: string, orgId: string, id: string) {
    const leaveType = await this.prisma.leaveType.findFirst({
      where: { id, orgId },
    });

    if (!leaveType) {
      throw new NotFoundException('Leave type not found');
    }

    const updated = await this.prisma.leaveType.update({
      where: { id },
      data: { active: false },
    });

    await this.auditService.log({
      orgId,
      actorId,
      action: AuditAction.LEAVE_TYPE_DEACTIVATED,
      reason: 'Leave type deactivated by HR',
      metadata: { leaveTypeId: id },
    });

    return updated;
  }

  /**
   * 4. PATCH /leave-types/:id/reactivate
   */
  async reactivateLeaveType(actorId: string, orgId: string, id: string) {
    const leaveType = await this.prisma.leaveType.findFirst({
      where: { id, orgId },
    });

    if (!leaveType) {
      throw new NotFoundException('Leave type not found');
    }

    const updated = await this.prisma.leaveType.update({
      where: { id },
      data: { active: true },
    });

    await this.auditService.log({
      orgId,
      actorId,
      action: AuditAction.LEAVE_TYPE_REACTIVATED,
      reason: 'Leave type reactivated by HR',
      metadata: { leaveTypeId: id },
    });

    return updated;
  }
}
