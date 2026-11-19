import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MinRole } from '../common/decorators/min-role.decorator';
import { ReportsService } from './reports.service';
import { QueryCalendarDto } from './dto/query-calendar.dto';
import { QueryOnLeaveDto } from './dto/query-on-leave.dto';
import { QueryBalanceSummaryDto } from './dto/query-balance-summary.dto';
import { QueryUtilizationDto } from './dto/query-utilization.dto';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('Reports & Calendar (HR Admin)')
@ApiBearerAuth('JWT-auth')
@Controller('reports')
@MinRole(Role.hr_admin)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('calendar')
  async getCalendar(
    @CurrentUser() caller: { orgId: string },
    @Query() query: QueryCalendarDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.reportsService.getCalendarReport(
      caller.orgId,
      query,
    );
    if (result.isCsv) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${result.filename}"`,
      );
      return result.csv;
    }
    return result.data;
  }

  @Get('on-leave')
  async getOnLeave(
    @CurrentUser() caller: { orgId: string },
    @Query() query: QueryOnLeaveDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.reportsService.getOnLeaveReport(
      caller.orgId,
      query,
    );
    if (result.isCsv) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${result.filename}"`,
      );
      return result.csv;
    }
    return result.data;
  }

  @Get('balance-summary')
  async getBalanceSummary(
    @CurrentUser() caller: { orgId: string },
    @Query() query: QueryBalanceSummaryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.reportsService.getBalanceSummaryReport(
      caller.orgId,
      query,
    );
    if (result.isCsv) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${result.filename}"`,
      );
      return result.csv;
    }
    return result.data;
  }

  @Get('utilization')
  async getUtilization(
    @CurrentUser() caller: { orgId: string },
    @Query() query: QueryUtilizationDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.reportsService.getUtilizationReport(
      caller.orgId,
      query,
    );
    if (result.isCsv) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${result.filename}"`,
      );
      return result.csv;
    }
    return result.data;
  }
}
