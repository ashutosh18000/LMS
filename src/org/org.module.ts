import { Module } from '@nestjs/common';
import { OrgController } from './org.controller';
import { OrgService } from './org.service';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { BalancesModule } from '../balances/balances.module';
import { LeaveRequestsModule } from '../leave-requests/leave-requests.module';

@Module({
  imports: [AuthModule, AuditModule, BalancesModule, LeaveRequestsModule],
  controllers: [OrgController],
  providers: [OrgService],
  exports: [OrgService],
})
export class OrgModule {}
