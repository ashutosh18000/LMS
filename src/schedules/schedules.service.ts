import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SaturdayMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditAction, AuditService } from '../audit/audit.service';
import { CreateScheduleTemplateDto } from './dto/create-schedule-template.dto';
import { UpdateScheduleTemplateDto } from './dto/update-schedule-template.dto';
import { AssignScheduleDto } from './dto/assign-schedule.dto';

@Injectable()
export class SchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  private validateAlternateMode(mode: SaturdayMode, weeks?: number[]) {
    if (mode === SaturdayMode.alternate) {
      if (!weeks || !Array.isArray(weeks)) {
        throw new BadRequestException(
          'alternateOffWeeks must be provided when saturdayMode is alternate',
        );
      }
      const sorted = weeks.slice().sort((a, b) => a - b);
      const str = JSON.stringify(sorted);
      if (str !== '[1,3]' && str !== '[2,4]') {
        throw new BadRequestException(
          'alternateOffWeeks can only be [1, 3] or [2, 4] in alternate mode',
        );
      }
    } else {
      if (weeks && weeks.length > 0) {
        throw new BadRequestException(
          'alternateOffWeeks is only allowed when saturdayMode is alternate',
        );
      }
    }
  }

  /**
   * 1. POST /schedule-templates
   */
  async createTemplate(
    creatorId: string,
    orgId: string,
    dto: CreateScheduleTemplateDto,
  ) {
    this.validateAlternateMode(dto.saturdayMode, dto.alternateOffWeeks);

    const existing = await this.prisma.workScheduleTemplate.findUnique({
      where: {
        orgId_name: {
          orgId,
          name: dto.name,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        'A schedule template with this name already exists in this organization',
      );
    }

    const template = await this.prisma.workScheduleTemplate.create({
      data: {
        orgId,
        name: dto.name,
        saturdayMode: dto.saturdayMode,
        alternateOffWeeks:
          dto.saturdayMode === SaturdayMode.alternate
            ? dto.alternateOffWeeks!
            : [],
        active: true,
      },
    });

    await this.auditService.log({
      orgId,
      actorId: creatorId,
      action: AuditAction.SCHEDULE_TEMPLATE_CREATED,
      reason: 'Schedule template created by HR',
      metadata: { templateId: template.id, name: template.name },
    });

    return template;
  }

  /**
   * 2. GET /schedule-templates
   */
  async getTemplates(orgId: string, active?: boolean) {
    return this.prisma.workScheduleTemplate.findMany({
      where: {
        orgId,
        ...(active !== undefined && { active }),
      },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * 2b. GET /schedule-templates/:id
   */
  async getTemplateById(orgId: string, id: string) {
    const template = await this.prisma.workScheduleTemplate.findFirst({
      where: { id, orgId },
    });

    if (!template) {
      throw new NotFoundException('Schedule template not found');
    }

    return template;
  }

  /**
   * 3. PATCH /schedule-templates/:id
   */
  async updateTemplate(
    actorId: string,
    orgId: string,
    id: string,
    dto: UpdateScheduleTemplateDto,
  ) {
    const template = await this.prisma.workScheduleTemplate.findFirst({
      where: { id, orgId },
    });

    if (!template) {
      throw new NotFoundException('Schedule template not found');
    }

    if (dto.name && dto.name !== template.name) {
      const existing = await this.prisma.workScheduleTemplate.findUnique({
        where: { orgId_name: { orgId, name: dto.name } },
      });
      if (existing) {
        throw new ConflictException(
          'A schedule template with this name already exists in this organization',
        );
      }
    }

    const targetMode = dto.saturdayMode ?? template.saturdayMode;
    const targetWeeks =
      dto.alternateOffWeeks !== undefined
        ? dto.alternateOffWeeks
        : template.alternateOffWeeks;

    this.validateAlternateMode(targetMode, targetWeeks);

    const updated = await this.prisma.workScheduleTemplate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.saturdayMode !== undefined && { saturdayMode: dto.saturdayMode }),
        alternateOffWeeks:
          targetMode === SaturdayMode.alternate ? targetWeeks : [],
      },
    });

    await this.auditService.log({
      orgId,
      actorId,
      action: AuditAction.SCHEDULE_TEMPLATE_UPDATED,
      reason: 'Schedule template updated by HR',
      metadata: { templateId: id, updatedFields: dto },
    });

    return updated;
  }

  /**
   * 4. PATCH /schedule-templates/:id/deactivate
   */
  async deactivateTemplate(actorId: string, orgId: string, id: string) {
    const template = await this.prisma.workScheduleTemplate.findFirst({
      where: { id, orgId },
    });

    if (!template) {
      throw new NotFoundException('Schedule template not found');
    }

    // Check if any active user in the organization currently has this template assigned
    const now = new Date();
    const candidateSchedules = await this.prisma.employeeSchedule.findMany({
      where: {
        orgId,
        templateId: id,
        effectiveFrom: { lte: now },
        user: { active: true },
      },
      select: { userId: true },
    });

    if (candidateSchedules.length > 0) {
      const userIds = [...new Set(candidateSchedules.map((s) => s.userId))];
      for (const userId of userIds) {
        const latest = await this.prisma.employeeSchedule.findFirst({
          where: {
            userId,
            effectiveFrom: { lte: now },
          },
          orderBy: { effectiveFrom: 'desc' },
          select: { templateId: true },
        });
        if (latest && latest.templateId === id) {
          throw new ConflictException(
            'Cannot deactivate template because it is currently assigned to one or more active employees',
          );
        }
      }
    }

    const updated = await this.prisma.workScheduleTemplate.update({
      where: { id },
      data: { active: false },
    });

    await this.auditService.log({
      orgId,
      actorId,
      action: AuditAction.SCHEDULE_TEMPLATE_DEACTIVATED,
      reason: 'Schedule template deactivated by HR',
      metadata: { templateId: id },
    });

    return updated;
  }

  /**
   * 4. PATCH /schedule-templates/:id/reactivate
   */
  async reactivateTemplate(actorId: string, orgId: string, id: string) {
    const template = await this.prisma.workScheduleTemplate.findFirst({
      where: { id, orgId },
    });

    if (!template) {
      throw new NotFoundException('Schedule template not found');
    }

    const updated = await this.prisma.workScheduleTemplate.update({
      where: { id },
      data: { active: true },
    });

    await this.auditService.log({
      orgId,
      actorId,
      action: AuditAction.SCHEDULE_TEMPLATE_REACTIVATED,
      reason: 'Schedule template reactivated by HR',
      metadata: { templateId: id },
    });

    return updated;
  }

  /**
   * 5. POST /users/:id/schedule
   */
  async assignSchedule(
    creatorId: string,
    orgId: string,
    targetUserId: string,
    dto: AssignScheduleDto,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: targetUserId, orgId },
    });

    if (!user) {
      throw new NotFoundException('User not found in this organization');
    }

    const template = await this.prisma.workScheduleTemplate.findFirst({
      where: { id: dto.templateId, orgId, active: true },
    });

    if (!template) {
      throw new BadRequestException('Schedule template not found or is inactive');
    }

    // Normalize date to UTC calendar date
    const dateStr = dto.effectiveFrom.substring(0, 10);
    const effectiveFrom = new Date(`${dateStr}T00:00:00.000Z`);

    const existing = await this.prisma.employeeSchedule.findUnique({
      where: {
        userId_effectiveFrom: {
          userId: targetUserId,
          effectiveFrom,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        'An employee schedule already exists for this user on the specified effective date',
      );
    }

    const schedule = await this.prisma.employeeSchedule.create({
      data: {
        orgId,
        userId: targetUserId,
        templateId: dto.templateId,
        effectiveFrom,
        createdBy: creatorId,
      },
      include: { template: true },
    });

    await this.auditService.log({
      orgId,
      actorId: creatorId,
      targetUserId,
      action: AuditAction.SCHEDULE_ASSIGNED,
      reason: 'Schedule assigned to employee',
      metadata: {
        templateId: dto.templateId,
        effectiveFrom: dateStr,
      },
    });

    return schedule;
  }

  /**
   * 6. GET /users/:id/schedules
   */
  async getUserSchedules(orgId: string, targetUserId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: targetUserId, orgId },
    });

    if (!user) {
      throw new NotFoundException('User not found in this organization');
    }

    return this.prisma.employeeSchedule.findMany({
      where: { userId: targetUserId, orgId },
      orderBy: { effectiveFrom: 'desc' },
      include: { template: true },
    });
  }

  /**
   * 7. GET /me/schedule
   */
  async getMySchedule(userId: string, orgId: string) {
    const history = await this.prisma.employeeSchedule.findMany({
      where: { userId, orgId },
      orderBy: { effectiveFrom: 'desc' },
      include: { template: true },
    });

    const currentSchedule =
      history.find((s) => new Date(s.effectiveFrom) <= new Date()) || null;

    return {
      currentSchedule,
      history,
    };
  }
}
