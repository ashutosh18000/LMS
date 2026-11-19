import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { UsersModule } from './users/users.module';
import { LeaveTypesModule } from './leave-types/leave-types.module';
import { SchedulesModule } from './schedules/schedules.module';
import { HolidaysModule } from './holidays/holidays.module';
import { BalancesModule } from './balances/balances.module';
import { LeaveRequestsModule } from './leave-requests/leave-requests.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { ClockModule } from './common/clock.module';
import { AuditModule } from './audit/audit.module';
import { PlatformModule } from './platform/platform.module';
import { OrgModule } from './org/org.module';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { MustChangePasswordGuard } from './common/guards/must-change-password.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.example'],
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 10,
      },
    ]),
    PrismaModule,
    AuditModule,
    HealthModule,
    AuthModule,
    OrganizationsModule,
    UsersModule,
    LeaveTypesModule,
    SchedulesModule,
    HolidaysModule,
    BalancesModule,
    LeaveRequestsModule,
    ApprovalsModule,
    ClockModule,
    PlatformModule,
    OrgModule,
  ],
  providers: [
    // Guard execution order:
    // 1. AppThrottlerGuard (rate-limits IP before heavy work, bypassed in NODE_ENV=test)
    // 2. JwtAuthGuard (authenticates user, resolves @Public())
    // 3. MustChangePasswordGuard (blocks routes if mustChangePassword is true)
    // 4. RolesGuard (verifies @MinRole hierarchy)
    {
      provide: APP_GUARD,
      useClass: AppThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: MustChangePasswordGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
