import { Module } from '@nestjs/common';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';
import { BalancesModule } from '../balances/balances.module';
import { LeaveRequestsModule } from '../leave-requests/leave-requests.module';

@Module({
  imports: [BalancesModule, LeaveRequestsModule],
  controllers: [ApprovalsController],
  providers: [ApprovalsService],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
