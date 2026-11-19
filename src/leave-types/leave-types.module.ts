import { Module } from '@nestjs/common';
import { LeaveTypesController } from './leave-types.controller';
import { LeaveTypesService } from './leave-types.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [LeaveTypesController],
  providers: [LeaveTypesService],
  exports: [LeaveTypesService],
})
export class LeaveTypesModule {}
