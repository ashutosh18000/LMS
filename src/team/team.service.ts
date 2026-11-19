import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AvailabilityService } from '../common/services/availability.service';
import { ClockService } from '../common/services/clock.service';

@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availabilityService: AvailabilityService,
    private readonly clockService: ClockService,
  ) {}

  /**
   * Resolves members of the caller's team for /my-team endpoints.
   * - Staff: Peers reporting to the same managerId (excluding caller) + caller's manager.
   * - Manager: Direct reports.
   * - User without managerId and not managing anyone: Empty list.
   * - HR Admin / Org Owner: Direct reports if any, or peers + manager if assigned one.
   */
  async resolveMyTeamMemberIds(caller: {
    id: string;
    role: Role;
    orgId: string;
  }): Promise<string[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: caller.id },
      select: { id: true, role: true, managerId: true },
    });

    if (!user) {
      return [];
    }

    if (user.role === Role.staff) {
      if (!user.managerId) {
        return [];
      }

      const members = await this.prisma.user.findMany({
        where: {
          orgId: caller.orgId,
          active: true,
          OR: [
            { managerId: user.managerId, id: { not: user.id } },
            { id: user.managerId },
          ],
        },
        select: { id: true },
      });
      return members.map((m) => m.id);
    }

    if (user.role === Role.manager) {
      const reports = await this.prisma.user.findMany({
        where: {
          orgId: caller.orgId,
          managerId: user.id,
          active: true,
        },
        select: { id: true },
      });
      return reports.map((r) => r.id);
    }

    // HR Admin or Org Owner
    const reports = await this.prisma.user.findMany({
      where: {
        orgId: caller.orgId,
        managerId: user.id,
        active: true,
      },
      select: { id: true },
    });
    if (reports.length > 0) {
      return reports.map((r) => r.id);
    }

    if (user.managerId) {
      const members = await this.prisma.user.findMany({
        where: {
          orgId: caller.orgId,
          active: true,
          OR: [
            { managerId: user.managerId, id: { not: user.id } },
            { id: user.managerId },
          ],
        },
        select: { id: true },
      });
      return members.map((m) => m.id);
    }

    return [];
  }

  /**
   * GET /team/availability
   * Manager's direct reports availability over [from, to].
   */
  async getTeamAvailability(
    caller: { id: string; orgId: string },
    from: string,
    to: string,
  ) {
    const directReports = await this.prisma.user.findMany({
      where: {
        orgId: caller.orgId,
        managerId: caller.id,
        active: true,
      },
      select: { id: true },
    });
    const memberIds = directReports.map((u) => u.id);
    return this.availabilityService.buildAvailability(
      caller.orgId,
      memberIds,
      from,
      to,
    );
  }

  /**
   * GET /team/availability/today
   * Manager's direct reports availability for today.
   */
  async getTeamToday(caller: { id: string; orgId: string }) {
    const org = await this.prisma.organization.findUnique({
      where: { id: caller.orgId },
      select: { timezone: true },
    });
    const today = this.clockService.today(org?.timezone ?? 'UTC');

    const directReports = await this.prisma.user.findMany({
      where: {
        orgId: caller.orgId,
        managerId: caller.id,
        active: true,
      },
      select: { id: true },
    });
    const memberIds = directReports.map((u) => u.id);
    return this.availabilityService.buildToday(caller.orgId, memberIds, today);
  }

  /**
   * GET /my-team/availability
   * Team members availability over [from, to] for any logged-in user.
   */
  async getMyTeamAvailability(
    caller: { id: string; role: Role; orgId: string },
    from: string,
    to: string,
  ) {
    const memberIds = await this.resolveMyTeamMemberIds(caller);
    return this.availabilityService.buildAvailability(
      caller.orgId,
      memberIds,
      from,
      to,
    );
  }

  /**
   * GET /my-team/availability/today
   * Team members availability for today for any logged-in user.
   */
  async getMyTeamToday(caller: { id: string; role: Role; orgId: string }) {
    const org = await this.prisma.organization.findUnique({
      where: { id: caller.orgId },
      select: { timezone: true },
    });
    const today = this.clockService.today(org?.timezone ?? 'UTC');
    const memberIds = await this.resolveMyTeamMemberIds(caller);
    return this.availabilityService.buildToday(caller.orgId, memberIds, today);
  }
}
