import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrgStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from '../auth/password.service';
import { AuditAction, AuditService } from '../audit/audit.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { QueryOrganizationsDto } from './dto/query-organizations.dto';
import { OrgActionReasonDto } from './dto/org-action-reason.dto';
import { ReplaceOwnerDto } from './dto/replace-owner.dto';
import { ResetOwnerPasswordDto } from './dto/reset-owner-password.dto';
import { PaginatedResult } from '../common/dto/pagination.dto';

@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * 1. POST /platform/organizations
   * Atomically creates Organization with default settings and its initial org_owner.
   * If any step fails, entire transaction rolls back.
   */
  async createOrganization(rootUserId: string, dto: CreateOrganizationDto) {
    const ownerEmail = dto.ownerEmail.toLowerCase().trim();

    // Enforce platform-wide email uniqueness before entering transaction
    const existingUser = await this.prisma.user.findUnique({
      where: { email: ownerEmail },
    });
    if (existingUser) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await this.passwordService.hash(dto.tempPassword);

    const result = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: dto.orgName,
          status: OrgStatus.active,
          timezone: 'Asia/Kolkata',
          financialYearStartMonth: 4,
          workingDays: [1, 2, 3, 4, 5],
          backdateAllowedDays: 7,
        },
      });

      const owner = await tx.user.create({
        data: {
          orgId: organization.id,
          email: ownerEmail,
          name: dto.ownerName,
          passwordHash,
          role: Role.org_owner,
          mustChangePassword: true,
          active: true,
        },
      });

      return { organization, owner };
    });

    // Record immutable audit log (orgId points to the target org so tenant owner can view it)
    await this.auditService.log({
      orgId: result.organization.id,
      actorId: rootUserId,
      targetUserId: result.owner.id,
      action: AuditAction.ORG_CREATED,
      reason: `Organization created by platform root`,
      metadata: {
        orgName: result.organization.name,
        ownerEmail: result.owner.email,
      },
    });

    return {
      organization: {
        id: result.organization.id,
        name: result.organization.name,
        status: result.organization.status,
        timezone: result.organization.timezone,
        createdAt: result.organization.createdAt,
      },
      owner: {
        id: result.owner.id,
        name: result.owner.name,
        email: result.owner.email,
        role: result.owner.role,
      },
    };
  }

  /**
   * 2. GET /platform/organizations
   * Returns paginated list of organizations with active owner and user count.
   */
  async getOrganizations(
    query: QueryOrganizationsDto,
  ): Promise<PaginatedResult<any>> {
    const where: Prisma.OrganizationWhereInput = query.status
      ? { status: query.status }
      : {};

    const [total, orgs] = await Promise.all([
      this.prisma.organization.count({ where }),
      this.prisma.organization.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { createdAt: 'desc' },
        include: {
          users: {
            where: { role: Role.org_owner, active: true },
            select: { id: true, name: true, email: true },
          },
          _count: {
            select: {
              users: { where: { active: true } },
            },
          },
        },
      }),
    ]);

    const items = orgs.map((org) => ({
      id: org.id,
      name: org.name,
      status: org.status,
      timezone: org.timezone,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
      owner: org.users[0] || null,
      activeUsersCount: org._count.users,
    }));

    return {
      items,
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * 3. GET /platform/organizations/:id
   * Returns single organization detailed view with settings.
   */
  async getOrganizationById(id: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        users: {
          where: { role: Role.org_owner, active: true },
          select: { id: true, name: true, email: true },
        },
        _count: {
          select: {
            users: { where: { active: true } },
          },
        },
      },
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
      owner: org.users[0] || null,
      activeUsersCount: org._count.users,
    };
  }

  /**
   * 4. PATCH /platform/organizations/:id/suspend
   */
  async suspendOrganization(
    rootUserId: string,
    id: string,
    dto: OrgActionReasonDto,
  ) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.organization.update({
        where: { id },
        data: { status: OrgStatus.suspended },
      });

      // Immediately revoke all active refresh tokens for users in this suspended organization
      await tx.refreshToken.deleteMany({
        where: { user: { orgId: id } },
      });

      return result;
    });

    await this.auditService.log({
      orgId: id,
      actorId: rootUserId,
      action: AuditAction.ORG_SUSPENDED,
      reason: dto.reason,
      metadata: { reason: dto.reason, previousStatus: org.status },
    });

    return {
      message: 'Organization suspended successfully',
      organization: {
        id: updated.id,
        name: updated.name,
        status: updated.status,
      },
    };
  }

  /**
   * 4. PATCH /platform/organizations/:id/activate
   */
  async activateOrganization(
    rootUserId: string,
    id: string,
    dto: OrgActionReasonDto,
  ) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    const updated = await this.prisma.organization.update({
      where: { id },
      data: { status: OrgStatus.active },
    });

    await this.auditService.log({
      orgId: id,
      actorId: rootUserId,
      action: AuditAction.ORG_ACTIVATED,
      reason: dto.reason,
      metadata: { reason: dto.reason, previousStatus: org.status },
    });

    return {
      message: 'Organization activated successfully',
      organization: {
        id: updated.id,
        name: updated.name,
        status: updated.status,
      },
    };
  }

  /**
   * 5. POST /platform/organizations/:id/replace-owner
   * Replaces current active owner with another active member of the same org.
   * STRICT ORDER: In transaction, old owner is updated to hr_admin FIRST,
   * then new user becomes org_owner. This strictly respects the partial unique index.
   */
  async replaceOwner(rootUserId: string, id: string, dto: ReplaceOwnerDto) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    const newOwnerCandidate = await this.prisma.user.findFirst({
      where: { id: dto.newOwnerUserId, orgId: id, active: true },
    });
    if (!newOwnerCandidate) {
      throw new BadRequestException(
        'Target user must be an active member of this organization',
      );
    }

    if (newOwnerCandidate.role === Role.org_owner) {
      throw new BadRequestException('Target user is already the organization owner');
    }

    const currentOwner = await this.prisma.user.findFirst({
      where: { orgId: id, role: Role.org_owner, active: true },
    });

    await this.prisma.$transaction(async (tx) => {
      // Step 1: Demote old owner to hr_admin first (frees the partial unique index slot)
      if (currentOwner) {
        await tx.user.update({
          where: { id: currentOwner.id },
          data: { role: Role.hr_admin },
        });
      }

      // Step 2: Promote new owner to org_owner
      await tx.user.update({
        where: { id: newOwnerCandidate.id },
        data: { role: Role.org_owner },
      });

      // Step 3: Revoke refresh tokens of both users
      const userIds = [newOwnerCandidate.id];
      if (currentOwner) userIds.push(currentOwner.id);

      await tx.refreshToken.deleteMany({
        where: { userId: { in: userIds } },
      });
    });

    await this.auditService.log({
      orgId: id,
      actorId: rootUserId,
      targetUserId: newOwnerCandidate.id,
      action: AuditAction.OWNER_REPLACED,
      reason: dto.reason,
      metadata: {
        previousOwnerId: currentOwner?.id,
        newOwnerId: newOwnerCandidate.id,
        reason: dto.reason,
      },
    });

    return {
      message: 'Organization owner replaced successfully',
      previousOwnerId: currentOwner?.id,
      newOwnerId: newOwnerCandidate.id,
    };
  }

  /**
   * 6. POST /platform/organizations/:id/reset-owner-password
   */
  async resetOwnerPassword(
    rootUserId: string,
    id: string,
    dto: ResetOwnerPasswordDto,
  ) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    const owner = await this.prisma.user.findFirst({
      where: { orgId: id, role: Role.org_owner, active: true },
    });
    if (!owner) {
      throw new NotFoundException('No active organization owner found');
    }

    const passwordHash = await this.passwordService.hash(dto.tempPassword);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: owner.id },
        data: {
          passwordHash,
          mustChangePassword: true,
        },
      });

      // Revoke all refresh tokens for the owner
      await tx.refreshToken.deleteMany({
        where: { userId: owner.id },
      });
    });

    await this.auditService.log({
      orgId: id,
      actorId: rootUserId,
      targetUserId: owner.id,
      action: AuditAction.OWNER_PASSWORD_RESET,
      reason: dto.reason,
      metadata: { ownerId: owner.id, reason: dto.reason },
    });

    return {
      message: 'Owner password reset successfully',
      ownerId: owner.id,
    };
  }
}
