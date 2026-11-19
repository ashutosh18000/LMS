import { Module } from '@nestjs/common';
import { LeaveRequestsController } from './leave-requests.controller';
import { LeaveRequestsService } from './leave-requests.service';
import { SchedulesModule } from '../schedules/schedules.module';
import { BalancesModule } from '../balances/balances.module';
import { ClockModule } from '../common/clock.module';

@Module({
  imports: [SchedulesModule, BalancesModule, ClockModule],
  controllers: [LeaveRequestsController],
  providers: [LeaveRequestsService],
  exports: [LeaveRequestsService],
})
export class LeaveRequestsModule {}
