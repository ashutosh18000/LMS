import { Module } from '@nestjs/common';
import { ScheduleTemplatesController } from './schedule-templates.controller';
import { MeScheduleController } from './me-schedule.controller';
import { SchedulesService } from './schedules.service';
import { ScheduleResolverService } from './schedule-resolver.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [ScheduleTemplatesController, MeScheduleController],
  providers: [SchedulesService, ScheduleResolverService],
  exports: [SchedulesService, ScheduleResolverService],
})
export class SchedulesModule {}
