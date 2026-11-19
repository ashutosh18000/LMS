import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { SchedulesModule } from '../schedules/schedules.module';
import { BalancesModule } from '../balances/balances.module';
import { LeaveRequestsModule } from '../leave-requests/leave-requests.module';

@Module({
  imports: [
    AuthModule,
    AuditModule,
    SchedulesModule,
    BalancesModule,
    LeaveRequestsModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
