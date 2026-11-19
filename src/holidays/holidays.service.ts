import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditAction, AuditService } from '../audit/audit.service';
import { CreateHolidayDto } from './dto/create-holiday.dto';
import { UpdateHolidayDto } from './dto/update-holiday.dto';
import { QueryHolidaysDto } from './dto/query-holidays.dto';

@Injectable()
export class HolidaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * 1. POST /holidays
   * If an active holiday already exists on this date -> 409.
   * If an inactive holiday exists on this date -> reactivates and updates name.
   */
  async createHoliday(
    creatorId: string,
    orgId: string,
    dto: CreateHolidayDto,
  ) {
    const dateStr = dto.date.substring(0, 10);
    const targetDate = new Date(`${dateStr}T00:00:00.000Z`);

    const existing = await this.prisma.holiday.findUnique({
      where: {
        orgId_date: {
          orgId,
          date: targetDate,
        },
      },
    });

    if (existing) {
      if (existing.active) {
        throw new ConflictException(
          'A holiday is already active on this date in this organization',
        );
      }

      // Reactivate existing inactive holiday and update its name
      const reactivated = await this.prisma.holiday.update({
        where: { id: existing.id },
        data: {
          name: dto.name,
          active: true,
        },
      });

      await this.auditService.log({
        orgId,
        actorId: creatorId,
        action: AuditAction.HOLIDAY_CREATED,
        reason: 'Inactive holiday reactivated upon re-addition',
        metadata: {
          holidayId: reactivated.id,
          date: dateStr,
          name: reactivated.name,
        },
      });

      return reactivated;
    }

    const holiday = await this.prisma.holiday.create({
      data: {
        orgId,
        date: targetDate,
        name: dto.name,
        active: true,
      },
    });

    await this.auditService.log({
      orgId,
      actorId: creatorId,
      action: AuditAction.HOLIDAY_CREATED,
      reason: 'Holiday created by HR',
      metadata: {
        holidayId: holiday.id,
        date: dateStr,
        name: holiday.name,
      },
    });

    return holiday;
  }

  /**
   * 2. GET /holidays
   * Open to all authenticated users. Defaults to current calendar year.
   */
  async getHolidays(orgId: string, query: QueryHolidaysDto) {
    const targetYear = query.year ?? new Date().getUTCFullYear();
    const startOfYear = new Date(Date.UTC(targetYear, 0, 1));
    const endOfYear = new Date(Date.UTC(targetYear, 11, 31, 23, 59, 59, 999));

    return this.prisma.holiday.findMany({
      where: {
        orgId,
        active: true,
        date: {
          gte: startOfYear,
          lte: endOfYear,
        },
      },
      orderBy: { date: 'asc' },
    });
  }

  /**
   * 2b. GET /holidays/manage
   * HR_ADMIN+ can view inactive holidays too, and year filter is optional.
   */
  async getManageHolidays(orgId: string, year?: number) {
    const where: any = { orgId };
    if (year) {
      const startOfYear = new Date(Date.UTC(year, 0, 1));
      const endOfYear = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
      where.date = {
        gte: startOfYear,
        lte: endOfYear,
      };
    }

    return this.prisma.holiday.findMany({
      where,
      orderBy: { date: 'asc' },
    });
  }

  /**
   * 2c. GET /holidays/:id
   */
  async getHolidayById(orgId: string, id: string) {
    const holiday = await this.prisma.holiday.findFirst({
      where: { id, orgId },
    });

    if (!holiday) {
      throw new NotFoundException('Holiday not found');
    }

    return holiday;
  }

  /**
   * 3. PATCH /holidays/:id
   */
  async updateHoliday(
    actorId: string,
    orgId: string,
    id: string,
    dto: UpdateHolidayDto,
  ) {
    const holiday = await this.prisma.holiday.findFirst({
      where: { id, orgId },
    });

    if (!holiday) {
      throw new NotFoundException('Holiday not found');
    }

    let newTargetDate: Date | undefined;
    if (dto.date) {
      const dateStr = dto.date.substring(0, 10);
      newTargetDate = new Date(`${dateStr}T00:00:00.000Z`);

      if (newTargetDate.getTime() !== holiday.date.getTime()) {
        const existingOnNewDate = await this.prisma.holiday.findUnique({
          where: {
            orgId_date: {
              orgId,
              date: newTargetDate,
            },
          },
        });
        if (existingOnNewDate && existingOnNewDate.id !== id && existingOnNewDate.active) {
          throw new ConflictException(
            'Another active holiday already exists on this new date',
          );
        }
      }
    }

    const updated = await this.prisma.holiday.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(newTargetDate !== undefined && { date: newTargetDate }),
      },
    });

    await this.auditService.log({
      orgId,
      actorId,
      action: AuditAction.HOLIDAY_UPDATED,
      reason: 'Holiday updated by HR',
      metadata: { holidayId: id, updatedFields: dto },
    });

    return updated;
  }

  /**
   * 4. PATCH /holidays/:id/deactivate
   */
  async deactivateHoliday(actorId: string, orgId: string, id: string) {
    const holiday = await this.prisma.holiday.findFirst({
      where: { id, orgId },
    });

    if (!holiday) {
      throw new NotFoundException('Holiday not found');
    }

    const updated = await this.prisma.holiday.update({
      where: { id },
      data: { active: false },
    });

    await this.auditService.log({
      orgId,
      actorId,
      action: AuditAction.HOLIDAY_DEACTIVATED,
      reason: 'Holiday deactivated by HR',
      metadata: { holidayId: id },
    });

    return updated;
  }

  /**
   * 5. PATCH /holidays/:id/reactivate
   */
  async reactivateHoliday(actorId: string, orgId: string, id: string) {
    const holiday = await this.prisma.holiday.findFirst({
      where: { id, orgId },
    });

    if (!holiday) {
      throw new NotFoundException('Holiday not found');
    }

    const updated = await this.prisma.holiday.update({
      where: { id },
      data: { active: true },
    });

    await this.auditService.log({
      orgId,
      actorId,
      action: AuditAction.HOLIDAY_REACTIVATED,
      reason: 'Holiday reactivated by HR',
      metadata: { holidayId: id },
    });

    return updated;
  }
}
