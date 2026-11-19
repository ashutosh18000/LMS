import {
  BadRequestException,
  ConflictException,
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
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ReassignReportsDto } from './dto/reassign-reports.dto';
import { ResetUserPasswordDto } from './dto/reset-user-password.dto';
import { PaginatedResult } from '../common/dto/pagination.dto';

const USER_SELECT_FIELDS = {
  id: true,
  orgId: true,
  email: true,
  name: true,
  role: true,
  managerId: true,
  department: true,
  joiningDate: true,
  mustChangePassword: true,
  active: true,
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly auditService: AuditService,
    private readonly balancesService: BalancesService,
    private readonly leaveRequestsService: LeaveRequestsService,
  ) {}

  /**
   * 1. POST /users
   * HR creates staff or manager users. hr_admin, org_owner, root are not managed here.
   */
  async createUser(creatorId: string, orgId: string, dto: CreateUserDto) {
    const email = dto.email.toLowerCase().trim();

    // Check email uniqueness across the entire platform
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    // Manager role cannot have a managerId
    if (dto.role === Role.manager && dto.managerId) {
      throw new BadRequestException('Managers cannot have a managerId');
    }

    // If staff user and managerId provided, validate manager
    if (dto.role === Role.staff && dto.managerId) {
      const manager = await this.prisma.user.findFirst({
        where: { id: dto.managerId, orgId, role: Role.manager, active: true },
      });
      if (!manager) {
        throw new BadRequestException(
          'Assigned manager must be an active manager in this organization',
        );
      }
    }

    // If scheduleTemplateId provided, validate template
    if (dto.scheduleTemplateId) {
      const template = await this.prisma.workScheduleTemplate.findFirst({
        where: { id: dto.scheduleTemplateId, orgId, active: true },
      });
      if (!template) {
        throw new BadRequestException(
          'Schedule template not found or is inactive',
        );
      }
    }

    const passwordHash = await this.passwordService.hash(dto.tempPassword);
    const joiningDate = dto.joiningDate ? new Date(dto.joiningDate) : null;

    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          orgId,
          email,
          name: dto.name,
          passwordHash,
          role: dto.role,
          managerId: dto.role === Role.manager ? null : (dto.managerId ?? null),
          department: dto.department ?? null,
          joiningDate,
          mustChangePassword: true,
          active: true,
        },
        select: USER_SELECT_FIELDS,
      });

      let schedule = null;
      if (dto.scheduleTemplateId) {
        const effectiveFrom = joiningDate ?? new Date();
        schedule = await tx.employeeSchedule.create({
          data: {
            orgId,
            userId: user.id,
            templateId: dto.scheduleTemplateId,
            effectiveFrom,
            createdBy: creatorId,
          },
        });
      }

      return { user, schedule };
    });

    await this.auditService.log({
      orgId,
      actorId: creatorId,
      targetUserId: result.user.id,
      action: AuditAction.USER_CREATED,
      reason: `User created with role ${result.user.role}`,
      metadata: {
        userId: result.user.id,
        email: result.user.email,
        role: result.user.role,
        scheduleCreated: !!result.schedule,
      },
    });

    // Hook: Allocate initial balances for eligible user (prorated)
    try {
      await this.balancesService.allocateForUser(result.user.id);
    } catch (err: any) {
      this.logger.error(
        `Failed to allocate initial balances for user ${result.user.id}: ${err.message}`,
      );
    }

    return result.user;
  }

  /**
   * 2. GET /users
   * Returns paginated list of staff and manager users.
   */
  async getUsers(
    orgId: string,
    query: QueryUsersDto,
  ): Promise<PaginatedResult<any>> {
    const where: Prisma.UserWhereInput = {
      orgId,
      role: query.role ? query.role : { in: [Role.staff, Role.manager] },
      ...(query.department && {
        department: { contains: query.department, mode: 'insensitive' },
      }),
      ...(query.active !== undefined && { active: query.active }),
      ...(query.managerId && { managerId: query.managerId }),
      ...(query.search && {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { email: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
    };

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { createdAt: 'desc' },
        select: {
          ...USER_SELECT_FIELDS,
          manager: {
            select: { id: true, name: true, email: true },
          },
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
   * 3. GET /users/:id
   * Returns user details with their current active schedule template.
   */
  async getUserById(orgId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        id,
        orgId,
        role: { in: [Role.staff, Role.manager] },
      },
      select: {
        ...USER_SELECT_FIELDS,
        manager: {
          select: { id: true, name: true, email: true },
        },
        employeeSchedules: {
          where: { effectiveFrom: { lte: new Date() } },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
          include: { template: true },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const currentScheduleTemplate =
      user.employeeSchedules[0]?.template || null;

    const { employeeSchedules, ...sanitizedUser } = user;

    return {
      ...sanitizedUser,
      currentScheduleTemplate,
    };
  }

  /**
   * 4. PATCH /users/:id
   */
  async updateUser(
    actorId: string,
    orgId: string,
    id: string,
    dto: UpdateUserDto,
  ) {
    const user = await this.prisma.user.findFirst({
      where: {
        id,
        orgId,
        role: { in: [Role.staff, Role.manager] },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const targetRole = dto.role ?? user.role;

    // Check demotion from manager to staff: cannot demote if active direct reports exist
    if (user.role === Role.manager && targetRole === Role.staff) {
      const reportsCount = await this.prisma.user.count({
        where: { managerId: id, orgId, active: true },
      });
      if (reportsCount > 0) {
        throw new ConflictException(
          `Manager has ${reportsCount} direct report(s). Reassign reports before demoting to staff.`,
        );
      }
    }

    // Role changing to manager: managerId must become null
    let newManagerId = dto.managerId !== undefined ? dto.managerId : user.managerId;
    if (targetRole === Role.manager) {
      if (dto.managerId && dto.managerId !== null) {
        throw new BadRequestException('Managers cannot have a managerId');
      }
      newManagerId = null;
    } else if (newManagerId) {
      // Validate assigned manager for staff
      const manager = await this.prisma.user.findFirst({
        where: { id: newManagerId, orgId, role: Role.manager, active: true },
      });
      if (!manager || manager.id === id) {
        throw new BadRequestException(
          'Assigned manager must be an active manager in this organization',
        );
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.user.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.department !== undefined && { department: dto.department }),
          ...(dto.joiningDate !== undefined && {
            joiningDate: dto.joiningDate ? new Date(dto.joiningDate) : null,
          }),
          ...(dto.role !== undefined && { role: dto.role }),
          managerId: newManagerId,
        },
        select: USER_SELECT_FIELDS,
      });

      // If role changed, revoke all active sessions
      if (dto.role && dto.role !== user.role) {
        await tx.refreshToken.deleteMany({ where: { userId: id } });
      }

      return res;
    });

    await this.auditService.log({
      orgId,
      actorId,
      targetUserId: id,
      action: AuditAction.USER_UPDATED,
      reason: 'User details updated by HR',
      metadata: { previousRole: user.role, updatedFields: dto },
    });

    return updated;
  }

  /**
   * 5. PATCH /users/:id/deactivate
   */
  async deactivateUser(actorId: string, orgId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        id,
        orgId,
        role: { in: [Role.staff, Role.manager] },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.active) {
      return { message: 'User is already inactive', user: { id: user.id, active: false } };
    }

    // Manager with active reports cannot be deactivated
    if (user.role === Role.manager) {
      const reportsCount = await this.prisma.user.count({
        where: { managerId: id, orgId, active: true },
      });
      if (reportsCount > 0) {
        throw new ConflictException(
          `Manager has ${reportsCount} active direct report(s). Reassign reports before deactivating.`,
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { active: false },
      });

      await tx.refreshToken.deleteMany({
        where: { userId: id },
      });

      // Automatically cancel any pending leave requests and release balances
      await this.leaveRequestsService.cancelUserPendingRequestsOnDeactivation(
        tx,
        orgId,
        id,
        actorId,
      );
    });

    await this.auditService.log({
      orgId,
      actorId,
      targetUserId: id,
      action: AuditAction.USER_DEACTIVATED,
      reason: 'User deactivated by HR',
    });

    return { message: 'User deactivated successfully', user: { id, active: false } };
  }

  /**
   * 5. PATCH /users/:id/reactivate
   */
  async reactivateUser(actorId: string, orgId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        id,
        orgId,
        role: { in: [Role.staff, Role.manager] },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    let newManagerId = user.managerId;
    // If user has a manager, verify if that manager is still active and has manager role
    if (user.managerId) {
      const manager = await this.prisma.user.findFirst({
        where: { id: user.managerId, orgId, role: Role.manager, active: true },
      });
      if (!manager) {
        newManagerId = null; // Clear stale manager
      }
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        active: true,
        managerId: newManagerId,
      },
      select: USER_SELECT_FIELDS,
    });

    await this.auditService.log({
      orgId,
      actorId,
      targetUserId: id,
      action: AuditAction.USER_REACTIVATED,
      reason: 'User reactivated by HR',
      metadata: { managerIdResetToNull: user.managerId !== null && newManagerId === null },
    });

    return { message: 'User reactivated successfully', user: updated };
  }

  /**
   * 6. POST /users/:id/reassign-reports
   */
  async reassignReports(
    actorId: string,
    orgId: string,
    id: string,
    dto: ReassignReportsDto,
  ) {
    const user = await this.prisma.user.findFirst({
      where: {
        id,
        orgId,
        role: { in: [Role.staff, Role.manager] },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (dto.newManagerId !== null) {
      if (dto.newManagerId === id) {
        throw new BadRequestException('Cannot reassign reports to the same manager');
      }

      const newManager = await this.prisma.user.findFirst({
        where: {
          id: dto.newManagerId,
          orgId,
          role: Role.manager,
          active: true,
        },
      });

      if (!newManager) {
        throw new BadRequestException(
          'Target manager must be an active manager in this organization',
        );
      }
    }

    const result = await this.prisma.user.updateMany({
      where: {
        managerId: id,
        orgId,
        active: true,
      },
      data: {
        managerId: dto.newManagerId,
      },
    });

    await this.auditService.log({
      orgId,
      actorId,
      targetUserId: id,
      action: AuditAction.MANAGER_REASSIGNED,
      reason: 'Direct reports reassigned by HR',
      metadata: {
        previousManagerId: id,
        newManagerId: dto.newManagerId,
        reassignedCount: result.count,
      },
    });

    return {
      message: 'Reports reassigned successfully',
      reassignedCount: result.count,
      newManagerId: dto.newManagerId,
    };
  }

  /**
   * 7. POST /users/:id/reset-password
   */
  async resetPassword(
    actorId: string,
    orgId: string,
    id: string,
    dto: ResetUserPasswordDto,
  ) {
    const user = await this.prisma.user.findFirst({
      where: {
        id,
        orgId,
        role: { in: [Role.staff, Role.manager] },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const passwordHash = await this.passwordService.hash(dto.tempPassword);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          passwordHash,
          mustChangePassword: true,
        },
      });

      await tx.refreshToken.deleteMany({
        where: { userId: id },
      });
    });

    await this.auditService.log({
      orgId,
      actorId,
      targetUserId: id,
      action: AuditAction.USER_PASSWORD_RESET,
      reason: 'Password reset by HR',
    });

    return { message: 'Password reset successfully', userId: id };
  }
}
