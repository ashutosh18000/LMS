import { Global, Module } from '@nestjs/common';
import { AvailabilityService } from './services/availability.service';
import { SchedulesModule } from '../schedules/schedules.module';

@Global()
@Module({
  imports: [SchedulesModule],
  providers: [AvailabilityService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
