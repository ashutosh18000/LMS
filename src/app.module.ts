import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env.validation';
import { RequestLoggingMiddleware } from './common/middleware/request-logging.middleware';
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
import { AvailabilityModule } from './common/availability.module';
import { AuditModule } from './audit/audit.module';
import { PlatformModule } from './platform/platform.module';
import { OrgModule } from './org/org.module';
import { TeamModule } from './team/team.module';
import { ReportsModule } from './reports/reports.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { MustChangePasswordGuard } from './common/guards/must-change-password.guard';
import { OrgScopeGuard } from './common/guards/org-scope.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      envFilePath: ['.env', '.env.example'],
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000,
        limit: 100,
      },
      {
        name: 'auth',
        ttl: 60000,
        limit: 5,
      },
      {
        name: 'refresh',
        ttl: 60000,
        limit: 10,
      },
      {
        name: 'platform',
        ttl: 60000,
        limit: 20,
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
    AvailabilityModule,
    PlatformModule,
    OrgModule,
    TeamModule,
    ReportsModule,
    DashboardModule,
  ],
  providers: [
    // Guard execution order:
    // 1. AppThrottlerGuard (rate-limits IP before heavy work, bypassed in NODE_ENV=test)
    // 2. JwtAuthGuard (authenticates user, resolves @Public())
    // 3. MustChangePasswordGuard (blocks routes if mustChangePassword is true)
    // 4. OrgScopeGuard (restricts root to /platform/*, /auth/*, /health; blocks non-root from /platform/*)
    // 5. RolesGuard (verifies @MinRole hierarchy)
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
      useClass: OrgScopeGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggingMiddleware).forRoutes('*');
  }
}
