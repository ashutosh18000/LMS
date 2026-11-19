import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { MinRole } from '../common/decorators/min-role.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { HolidaysService } from './holidays.service';
import { CreateHolidayDto } from './dto/create-holiday.dto';
import { UpdateHolidayDto } from './dto/update-holiday.dto';
import { QueryHolidaysDto } from './dto/query-holidays.dto';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('Holidays (HR Admin)')
@ApiBearerAuth('JWT-auth')
@Controller('holidays')
export class HolidaysController {
  constructor(private readonly holidaysService: HolidaysService) {}

  /**
   * 1. POST /holidays
   */
  @MinRole(Role.hr_admin)
  @HttpCode(HttpStatus.CREATED)
  @Post()
  async createHoliday(
    @CurrentUser('id') creatorId: string,
    @CurrentUser('orgId') orgId: string,
    @Body() dto: CreateHolidayDto,
  ) {
    return this.holidaysService.createHoliday(creatorId, orgId, dto);
  }

  /**
   * 2. GET /holidays
   * Accessible to all authenticated users.
   */
  @Get()
  async getHolidays(
    @CurrentUser('orgId') orgId: string,
    @Query() query: QueryHolidaysDto,
  ) {
    return this.holidaysService.getHolidays(orgId, query);
  }

  /**
   * 2b. GET /holidays/manage
   * HR_ADMIN+ endpoint, includes inactive holidays too, year filter optional.
   */
  @MinRole(Role.hr_admin)
  @Get('manage')
  async getManageHolidays(
    @CurrentUser('orgId') orgId: string,
    @Query('year') year?: string,
  ) {
    const yearNum = year ? parseInt(year, 10) : undefined;
    return this.holidaysService.getManageHolidays(orgId, yearNum);
  }

  /**
   * 2c. GET /holidays/:id
   */
  @Get(':id')
  async getHolidayById(
    @CurrentUser('orgId') orgId: string,
    @Param('id') id: string,
  ) {
    return this.holidaysService.getHolidayById(orgId, id);
  }

  /**
   * 3. PATCH /holidays/:id
   */
  @MinRole(Role.hr_admin)
  @Patch(':id')
  async updateHoliday(
    @CurrentUser('id') actorId: string,
    @CurrentUser('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: UpdateHolidayDto,
  ) {
    return this.holidaysService.updateHoliday(actorId, orgId, id, dto);
  }

  /**
   * 4. PATCH /holidays/:id/deactivate
   */
  @MinRole(Role.hr_admin)
  @Patch(':id/deactivate')
  async deactivateHoliday(
    @CurrentUser('id') actorId: string,
    @CurrentUser('orgId') orgId: string,
    @Param('id') id: string,
  ) {
    return this.holidaysService.deactivateHoliday(actorId, orgId, id);
  }

  /**
   * 5. PATCH /holidays/:id/reactivate
   */
  @MinRole(Role.hr_admin)
  @Patch(':id/reactivate')
  async reactivateHoliday(
    @CurrentUser('id') actorId: string,
    @CurrentUser('orgId') orgId: string,
    @Param('id') id: string,
  ) {
    return this.holidaysService.reactivateHoliday(actorId, orgId, id);
  }
}
