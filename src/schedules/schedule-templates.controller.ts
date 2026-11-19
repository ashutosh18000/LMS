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
import { SchedulesService } from './schedules.service';
import { CreateScheduleTemplateDto } from './dto/create-schedule-template.dto';
import { UpdateScheduleTemplateDto } from './dto/update-schedule-template.dto';

@MinRole(Role.hr_admin)
@Controller('schedule-templates')
export class ScheduleTemplatesController {
  constructor(private readonly schedulesService: SchedulesService) {}

  @HttpCode(HttpStatus.CREATED)
  @Post()
  async createTemplate(
    @CurrentUser('id') creatorId: string,
    @CurrentUser('orgId') orgId: string,
    @Body() dto: CreateScheduleTemplateDto,
  ) {
    return this.schedulesService.createTemplate(creatorId, orgId, dto);
  }

  @Get()
  async getTemplates(
    @CurrentUser('orgId') orgId: string,
    @Query('active') active?: string,
  ) {
    const activeBool =
      active === 'true' ? true : active === 'false' ? false : undefined;
    return this.schedulesService.getTemplates(orgId, activeBool);
  }

  @Get(':id')
  async getTemplateById(
    @CurrentUser('orgId') orgId: string,
    @Param('id') id: string,
  ) {
    return this.schedulesService.getTemplateById(orgId, id);
  }

  @Patch(':id')
  async updateTemplate(
    @CurrentUser('id') actorId: string,
    @CurrentUser('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: UpdateScheduleTemplateDto,
  ) {
    return this.schedulesService.updateTemplate(actorId, orgId, id, dto);
  }

  @Patch(':id/deactivate')
  async deactivateTemplate(
    @CurrentUser('id') actorId: string,
    @CurrentUser('orgId') orgId: string,
    @Param('id') id: string,
  ) {
    return this.schedulesService.deactivateTemplate(actorId, orgId, id);
  }

  @Patch(':id/reactivate')
  async reactivateTemplate(
    @CurrentUser('id') actorId: string,
    @CurrentUser('orgId') orgId: string,
    @Param('id') id: string,
  ) {
    return this.schedulesService.reactivateTemplate(actorId, orgId, id);
  }
}
