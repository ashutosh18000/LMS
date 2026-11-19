import { Module } from '@nestjs/common';
import { BalancesService } from './balances.service';
import { LeaveYearService } from './leave-year.service';
import { BalancesController } from './balances.controller';
import { MeBalancesController } from './me-balances.controller';

@Module({
  controllers: [BalancesController, MeBalancesController],
  providers: [BalancesService, LeaveYearService],
  exports: [BalancesService, LeaveYearService],
})
export class BalancesModule {}
