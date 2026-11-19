import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, OpenAPIObject } from '@nestjs/swagger';

export function createSwaggerDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Leave Management System API')
    .setDescription(
      `## Multi-tenant Leave Management System Backend
Production-ready API for enterprise employee leave and work schedule management.

### Key Business Invariants & Error Codes:
- **OVERLAP**: The requested leave or WFH dates conflict with an existing active request.
- **INSUFFICIENT_BALANCE**: Requested leave days exceed the available allocated balance for this leave type and financial year.
- **NO_BALANCE**: No leave balance has been allocated for this employee, leave type, and financial year.
- **MONTHLY_LIMIT_EXCEEDED**: Requested days in this calendar month exceed the configured monthly cap for this leave type.
- **PAST_LEAVE_NOT_ALLOWED**: Leave dates are further in the past than the organization's \`backdateAllowedDays\` window.
- **EXCEEDS_MAX_CONSECUTIVE_DAYS**: The continuous leave span exceeds the policy limit.
- **ZERO_COUNTED_DAYS**: The requested segment falls strictly on non-working days (Sundays, holidays, or weekly offs).
- **INVALID_SEGMENTS**: The request segments array is empty or inconsistent.
- **UNAUTHORIZED_CANCELLATION**: Only the employee or an HR administrator can cancel requests.
- **ALREADY_DECIDED**: The request has already been approved, rejected, or cancelled.

### Role Hierarchy (RBAC):
- **root**: Platform super-administrator (\`/platform/*\`)
- **org_owner**: Organization owner (\`/org/*\`)
- **hr_admin**: HR administrator (manages users, leave types, schedules, holidays, balances, approvals, reports)
- **manager**: Department/team manager (\`/team/*\`, \`/dashboard/team\`)
- **staff**: Tenant employee (\`/leave-requests/*\`, \`/my-team/*\`, \`/dashboard/me\`)
`,
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Enter your JWT access token (15-minute validity)',
        in: 'header',
      },
      'JWT-auth',
    )
    .build();

  return SwaggerModule.createDocument(app, config);
}

export function setupSwagger(app: INestApplication): void {
  const document = createSwaggerDocument(app);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'none',
      filter: true,
      showRequestDuration: true,
    },
    customSiteTitle: 'LMS API Documentation',
  });
}
