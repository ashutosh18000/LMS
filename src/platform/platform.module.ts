import { Module } from '@nestjs/common';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [PlatformController],
  providers: [PlatformService],
  exports: [PlatformService],
})
export class PlatformModule {}
