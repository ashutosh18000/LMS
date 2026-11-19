import { Module } from '@nestjs/common';
import { HolidaysController } from './holidays.controller';
import { HolidaysService } from './holidays.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [HolidaysController],
  providers: [HolidaysService],
  exports: [HolidaysService],
})
export class HolidaysModule {}
