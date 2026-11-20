# Multi-tenant Leave Management System Backend

Enterprise-grade multi-tenant Leave Management System (LMS) backend built with **NestJS**, **PostgreSQL (Neon)**, and **Prisma ORM**.

---

## 🏛️ System Overview

The LMS platform enables organizations to administer leave policies, work schedules, custom holiday calendars, balance allocations, and multi-segment leave requests with strict tenant isolation, role-based access control (RBAC), and day-type availability calculations.

```
                    ┌────────────────────────────┐
                    │      Root Administrator     │
                    │      (/platform/*)         │
                    └─────────────┬──────────────┘
                                  │ Manages Tenants
                    ┌─────────────▼──────────────┐
                    │    Tenant Organization     │
                    ├────────────────────────────┤
                    │ Owner:      /org/*         │
                    │ HR Admin:   /users,        │
                    │             /schedules,    │
                    │             /leave-types,  │
                    │             /holidays,     │
                    │             /balances,     │
                    │             /approvals,    │
                    │             /reports       │
                    │ Manager:    /team/*        │
                    │ Staff:      /leave-requests│
                    │ All Users:  /my-team, /me  │
                    └────────────────────────────┘
```

---

## 🔐 Roles × Endpoints Access Matrix

| Endpoint Group | Allowed Roles | Description | Notes |
| :--- | :--- | :--- | :--- |
| **`/auth/*`** | Public / All Users | Login, refresh token rotation, logout, password change, current user | Rate limited: login (5/min), refresh (10/min), password change (5/min). |
| **`/platform/*`** | `root` only | Tenant organization creation, suspension, owner replacement & password reset | Strict `OrgScopeGuard` blocks tenant users with 403. Root blocked from tenant routes. |
| **`/org/*`** | `org_owner` | Tenant settings, HR administrator creation, promotion, demotion, ownership transfer | Tenant-scoped by `@CurrentUser().orgId`. |
| **`/users/*`** | `hr_admin`, `org_owner` | Manage staff & managers, schedule assignment, temporary password reset, deactivation | Excludes root, owners, and HR admins. |
| **`/schedule-templates/*`** | `hr_admin`, `org_owner` | Create, update, list schedule templates (5-day, Saturday half, alternate Saturdays) | Sunday is universally off (`weight: 0`). |
| **`/leave-types/*`** | `hr_admin`, `org_owner` | Configure annual quotas, monthly limits, paid/unpaid, WFH categories | Read-only listing accessible to all logged-in tenant users. |
| **`/holidays/*`** | `hr_admin`, `org_owner` | Maintain organization holiday calendar | Read-only listing accessible to all logged-in tenant users. |
| **`/balances/allocate`** | `hr_admin`, `org_owner` | Allocate annual leave quotas with automated proration based on joining date | Supports `dryRun: true` preview. |
| **`/balances/adjust`** | `hr_admin`, `org_owner` | Manual quota adjustments with mandatory reason logging in audit trail | Resulting available balance cannot drop below 0. |
| **`/balances/carry-forward/*`** | `hr_admin`, `org_owner` | Preview and execute annual carry-forward up to `carryForwardMax` | Atomic multi-row balance execution. |
| **`/me/balances`** | All Logged-in Tenant Users | View current personal leave balances and monthly utilization | Filterable by leave year. |
| **`/leave-requests`** | `staff`, `manager`, `hr_admin` | Multi-segment leave & WFH submissions, preview calculations, personal listing | Owners cannot apply (`ForbiddenException`). |
| **`/leave-requests/on-behalf`** | `hr_admin`, `org_owner` | Submit backdated or emergency leave on behalf of employees | Supports `autoApprove: true`. |
| **`/leave-requests/:id/cancel`** | Request Owner | Cancel pending leave request before decision | Immediately releases reserved balance. |
| **`/leave-requests/:id/cancel-approved`** | `hr_admin`, `org_owner` | Cancel previously approved leave with mandatory reason | Automatically refunds balance from used. |
| **`/approvals/pending`** | `hr_admin`, `org_owner` | Inbox of pending leave requests awaiting approval | HR cannot decide their own leave requests. |
| **`/approvals/:id/approve`** | `hr_admin`, `org_owner` | Final approval decision | Commits balance from pending to used. |
| **`/approvals/:id/reject`** | `hr_admin`, `org_owner` | Rejection decision | Releases reserved balance back to available. |
| **`/team/availability`** | `manager` | Range availability of direct reports with `offDates`, `halfDates`, and `holidays` | Strictly redacts leave types, reasons, balances. |
| **`/team/availability/today`** | `manager` | Real-time single-day status (`off`, `leave`, `wfh`, `available`) with `halfDay` flag | Single-counting invariant guaranteed. |
| **`/my-team/availability`** | All Logged-in Tenant Users | Peer & manager availability view for team coordination | Same privacy shield as manager view. |
| **`/reports/*`** | `hr_admin`, `org_owner` | HR Calendar, On-Leave, Balance Summary, Utilization reports | Supports JSON & CSV (`?format=csv`) with formula injection mitigation. |
| **`/dashboard/*`** | Role-scoped | `/dashboard/me`, `/dashboard/team`, `/dashboard/hr`, `/dashboard/owner` | Tailored operational summaries and pending counts. |
| **`/health` & `/health/ready`** | Public / Monitoring | Liveness and database readiness probes | Allowed for all callers and orchestrators. |

---

## ⚙️ Environment Variables Reference Table

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | String | *Required* | Neon PostgreSQL **pooled** connection string (PgBouncer). Must end with `?sslmode=require&pgbouncer=true&connect_timeout=15`. |
| `DIRECT_URL` | String | *Required* | Neon PostgreSQL **direct** unpooled connection string (used for `prisma migrate deploy` and seeds). |
| `TEST_DATABASE_URL` | String | *Optional* | Dedicated connection string for automated tests against an isolated Neon branch or test database. |
| `JWT_ACCESS_SECRET` | String | *Required* | Secret key for 15-minute JWT access tokens (minimum 32 characters). |
| `JWT_REFRESH_SECRET` | String | *Required* | Secret key for 7-day JWT refresh tokens (minimum 32 characters, must differ from access secret). |
| `PORT` | Number | `3000` | Port for the HTTP application server. |
| `NODE_ENV` | String | `development` | Runtime environment (`development`, `production`, `test`). |
| `CORS_ORIGINS` | String | `*` (dev) | Comma-separated list of allowed origins for cross-origin requests (e.g., `https://app.example.com,https://admin.example.com`). |
| `COOKIE_SAMESITE` | String | `strict` | SameSite attribute for httpOnly refresh cookies (`strict`, `lax`, `none`). |
| `COOKIE_DOMAIN` | String | *Optional* | Domain attribute for refresh cookies (e.g., `.example.com` for cross-subdomain sharing). |
| `TRUST_PROXY` | String | *Optional* | Reverse proxy hops configuration (e.g., `1`, `true`) for accurate client IP rate limiting behind load balancers. |
| `SWAGGER_ENABLED` | Boolean | `false` in prod | Set to `true` to enable Swagger UI at `/docs` in production. (Always enabled in non-production). |
| `PRISMA_TRANSACTION_MAX_WAIT` | Number | `5000` | Maximum time (ms) Prisma Client waits to acquire a transaction connection from the pool. |
| `PRISMA_TRANSACTION_TIMEOUT` | Number | `10000` | Maximum execution duration (ms) for an interactive transaction before timing out. |
| `ROOT_EMAIL` | String | `root@example.com` | Initial root super-administrator email for `prisma db seed`. |
| `ROOT_PASSWORD` | String | `ChangeMeSuperSecret123!` | Initial root super-administrator password for `prisma db seed`. |

---

## 🍪 Cross-Domain Frontend Cookie Configuration Guide

When the frontend and backend are hosted across web origins:

1. **Recommended & Safest Architecture: Shared Parent Domain (e.g., `app.company.com` and `api.company.com`)**:
   - **Why this is the safest**: Placing both frontend and backend under the same parent domain (e.g. `company.com`) eliminates cross-site third-party cookie restrictions entirely.
   - Set `COOKIE_SAMESITE=lax`
   - Set `COOKIE_DOMAIN=.company.com`
   - Set `CORS_ORIGINS=https://app.company.com`
   - In frontend fetch / axios, set `credentials: 'include'` (or `withCredentials: true`).

2. **Cross-Site Distinct Domains (e.g., `https://my-lms.vercel.app` and `https://lms-api.render.com`)**:
   - Use `COOKIE_SAMESITE=none` **only** when frontend and backend reside on completely separate registrable domains.
   - **Crucial Browser Notice**: Modern privacy engines (such as Apple Safari's Intelligent Tracking Prevention - ITP, and Brave/Firefox privacy protections) block third-party cross-site cookies by default. Users on Safari may experience refresh token rejection unless third-party cookies are allowed or custom domain routing is configured.
   - When `COOKIE_SAMESITE=none` is used:
     - `secure: true` is strictly enforced (plain HTTP is rejected by browsers).
     - Leave `COOKIE_DOMAIN` unset.
     - Set `CORS_ORIGINS=https://my-lms.vercel.app`
     - In frontend fetch / axios, set `credentials: 'include'` (or `withCredentials: true`).

---

## 🗄️ Neon PostgreSQL & Connection Pooling Best Practices

- **Runtime Operations via PgBouncer**: `DATABASE_URL` points to Neon's connection pooler endpoint (host contains `-pooler`).
  - **Connection Limits**: Neon's pooled endpoint safely multiplexes thousands of incoming connections onto backend compute connections. Set `connection_limit=20` in the URL to prevent excessive client-side pool exhaustion during bursts.
- **Migrations & Seeds via Direct Endpoint**: `DIRECT_URL` connects directly to the PostgreSQL compute instance without PgBouncer. This is required because PgBouncer in transaction mode does not support session-level advisory locks or prepared statements used during DDL migrations.
- **Database Migrations Rule**: Always provision and update environments with `npx prisma migrate deploy` (never `prisma db push`). `migrate deploy` executes the migration SQL script containing the raw PostgreSQL partial unique indexes (`uq_one_active_owner_per_org`, `uq_single_root`) and check constraints (`chk_user_root_org`).

---

## 📖 Swagger API Documentation & Postman Collection

### 1. Interactive Swagger UI
- Available at: `http://localhost:3000/docs`
- Features interactive endpoint testing, comprehensive DTO schemas, role tags, and error code references.
- Configured with Bearer Authentication: click **Authorize** at the top right and enter your JWT access token.

### 2. Exporting OpenAPI Specification
```bash
npm run openapi:export
```
Generates two files in the project root:
- `openapi.json`: OpenAPI 3.0 specification.
- `postman_collection.json`: Ready-to-import Postman Collection v2.1.
- `lms.postman_environment.json`: Postman environment with `baseUrl` (`http://localhost:3000`) and `accessToken`.

### 3. Postman Collection Features
- **Automatic Token Capture**: The `POST /auth/login` request includes a built-in Postman Test Script that automatically saves the returned `accessToken` into the Postman environment variable `{{accessToken}}`. All subsequent requests automatically use this token!
- **Cookie Notice**: For `POST /auth/refresh` and `POST /auth/logout`, Postman automatically manages httpOnly cookies received from `/auth/login`.

---

## 🧪 Demo Data & Instant Testing

Populate your database with a complete demo tenant organization (`Acme Technologies`) showcasing all schedule variants, leave policies, and user roles:

```bash
npm run seed:demo
```
*(Refuses to run if `NODE_ENV=production`).*

### Demo Accounts Table (Password for all demo accounts: `DemoPassword123!`)

| Role | Email | Name | Schedule / Notes |
| :--- | :--- | :--- | :--- |
| **Org Owner** | `owner@acme.com` | Alice Owner | Full tenant administrative rights |
| **HR Admin** | `hr@acme.com` | Harry HR Admin | HR operations, policy, approvals, and reports |
| **Manager 1** | `manager1@acme.com` | Maya Manager | Engineering Manager (Standard 5-day schedule) |
| **Manager 2** | `manager2@acme.com` | Mohan Manager | Design & Support Manager (Standard 5-day schedule) |
| **Staff 1** | `staff1@acme.com` | Sam Staff | Engineering (Standard 5-day: Saturday Off) |
| **Staff 2** | `staff2@acme.com` | Sara Staff | Engineering (Saturday Half-Day Shift) |
| **Staff 3** | `staff3@acme.com` | Steve Staff | Engineering (Alternate Saturdays: 1st & 3rd Off) |
| **Staff 4** | `staff4@acme.com` | Sonia Staff | Design & Support (Alternate Saturdays: 2nd & 4th Off) |
| **Staff 5** | `staff5@acme.com` | Sean Staff | Design & Support (Org Default Fallback: Mon-Fri) |

---

## 🛠 Tech Stack & Rules

- **Framework**: NestJS (TypeScript)
- **Database**: PostgreSQL hosted on [Neon](https://neon.tech)
- **ORM**: Prisma (Latest stable v6)
- **Validation**: Strict DTO validation via `class-validator` & `class-transformer`
- **Global ValidationPipe**: `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`
- **Security & Utilities**: `helmet`, `compression`, `bcrypt` (10 salt rounds), `cookie-parser`, `@nestjs/config`, `@nestjs/throttler`, `@nestjs/jwt`, `@nestjs/passport`
- **Database Module**: Global `PrismaModule` + `PrismaService` with automatic connection retries (wake-up resilience for Neon serverless compute) and graceful shutdown hooks.

---

## 🔐 Auth Fixes & Security Rules

1. **Information Leakage Prevention in Login**:
   - Specific errors like `"Account is inactive"` and `"Organization is suspended"` are **only returned after verifying that the password is correct**.
   - If the password is wrong or the user does not exist, a generic 401 `"Invalid credentials"` is returned, accompanied by a dummy constant-time bcrypt comparison (`dummyCompare`) to eliminate timing-based user enumeration.
2. **Immediate Token Revocation on Refresh**:
   - In `POST /auth/refresh`, if the user has been deactivated or their organization suspended, the endpoint immediately returns 401 and **deletes all stored refresh tokens** for that user.
3. **Session Revocation on State Changes**:
   - Whenever a user's role or active status changes, or their password is reset, all active refresh tokens for that user are deleted from the database.

---

## 🌐 Platform (Root) Endpoints (`/platform`, `@MinRole(Role.root)`)

### 1. `POST /platform/organizations`
Atomically creates an Organization with default settings and its initial active `org_owner`. If either fails, the entire transaction rolls back.
- **Request Body**:
  ```json
  {
    "orgName": "Acme Corp",
    "ownerName": "Alice Owner",
    "ownerEmail": "alice@acme.com",
    "tempPassword": "TempPassword123!"
  }
  ```
- **Response (`201 Created`)**:
  ```json
  {
    "organization": {
      "id": "c1f7b022-7f93-4a3d-b4b0-951c5dc90610",
      "name": "Acme Corp",
      "status": "active",
      "timezone": "Asia/Kolkata",
      "createdAt": "2026-11-10T09:40:00.000Z"
    },
    "owner": {
      "id": "e3048995-c9bf-470a-8bf8-202d088921df",
      "name": "Alice Owner",
      "email": "alice@acme.com",
      "role": "org_owner"
    }
  }
  ```

### 2. `GET /platform/organizations`
Returns paginated list with active owner details and active user counts.
- **Query Params**: `?page=1&limit=20&status=active`
- **Response (`200 OK`)**:
  ```json
  {
    "items": [
      {
        "id": "c1f7b022-7f93-4a3d-b4b0-951c5dc90610",
        "name": "Acme Corp",
        "status": "active",
        "timezone": "Asia/Kolkata",
        "createdAt": "2026-11-10T09:40:00.000Z",
        "updatedAt": "2026-11-10T09:40:00.000Z",
        "owner": {
          "id": "e3048995-c9bf-470a-8bf8-202d088921df",
          "name": "Alice Owner",
          "email": "alice@acme.com"
        },
        "activeUsersCount": 1
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20
  }
  ```

### 3. `GET /platform/organizations/:id`
Returns detailed view of an organization including settings.
- **Response (`200 OK`)**:
  ```json
  {
    "id": "c1f7b022-7f93-4a3d-b4b0-951c5dc90610",
    "name": "Acme Corp",
    "status": "active",
    "timezone": "Asia/Kolkata",
    "financialYearStartMonth": 4,
    "workingDays": [1, 2, 3, 4, 5],
    "backdateAllowedDays": 7,
    "createdAt": "2026-11-10T09:40:00.000Z",
    "updatedAt": "2026-11-10T09:40:00.000Z",
    "owner": {
      "id": "e3048995-c9bf-470a-8bf8-202d088921df",
      "name": "Alice Owner",
      "email": "alice@acme.com"
    },
    "activeUsersCount": 1
  }
  ```

### 4. `PATCH /platform/organizations/:id/suspend` & `PATCH /platform/organizations/:id/activate`
Suspends or activates an organization. Suspending an org immediately revokes all active refresh tokens for users in that organization.
- **Request Body**:
  ```json
  {
    "reason": "Non-payment of subscription"
  }
  ```
- **Response (`200 OK`)**:
  ```json
  {
    "message": "Organization suspended successfully",
    "organization": {
      "id": "c1f7b022-7f93-4a3d-b4b0-951c5dc90610",
      "name": "Acme Corp",
      "status": "suspended"
    }
  }
  ```

### 5. `POST /platform/organizations/:id/replace-owner`
Replaces the organization owner with another active member. Strictly demotes the existing owner to `hr_admin` first, then promotes the new owner to `org_owner` in a single transaction, preserving the partial unique index.
- **Request Body**:
  ```json
  {
    "newOwnerUserId": "6ec621d1-678c-4a37-b2f7-7a87e5977a41",
    "reason": "Executive leadership transition"
  }
  ```
- **Response (`200 OK`)**:
  ```json
  {
    "message": "Organization owner replaced successfully",
    "previousOwnerId": "e3048995-c9bf-470a-8bf8-202d088921df",
    "newOwnerId": "6ec621d1-678c-4a37-b2f7-7a87e5977a41"
  }
  ```

### 6. `POST /platform/organizations/:id/reset-owner-password`
Resets the owner's password, marks `mustChangePassword = true`, and revokes all active sessions.
- **Request Body**:
  ```json
  {
    "tempPassword": "NewOwnerPassword123!",
    "reason": "Owner locked out of account"
  }
  ```
- **Response (`200 OK`)**:
  ```json
  {
    "message": "Owner password reset successfully",
    "ownerId": "e3048995-c9bf-470a-8bf8-202d088921df"
  }
  ```

---

## 🏢 Org Owner Endpoints (`/org`, `@MinRole(Role.org_owner)`)

All `/org` endpoints resolve `orgId` strictly from the authenticated token via `@CurrentUser('orgId')`.

### 1. `GET /org/settings` & `PATCH /org/settings`
- **PATCH Request Body** (all fields optional):
  ```json
  {
    "name": "Acme Global",
    "timezone": "America/New_York",
    "financialYearStartMonth": 1,
    "workingDays": [1, 2, 3, 4, 5, 6],
    "backdateAllowedDays": 14
  }
  ```
- **Response (`200 OK`)**:
  ```json
  {
    "message": "Settings updated successfully",
    "settings": {
      "name": "Acme Global",
      "timezone": "America/New_York",
      "financialYearStartMonth": 1,
      "workingDays": [1, 2, 3, 4, 5, 6],
      "backdateAllowedDays": 14
    }
  }
  ```

### 2. `POST /org/hr-admins`
Creates a new HR Admin user within the caller's organization.
- **Request Body**:
  ```json
  {
    "name": "Helen HR",
    "email": "helen@acme.com",
    "tempPassword": "HrPassword123!"
  }
  ```
- **Response (`201 Created`)**:
  ```json
  {
    "id": "78788f4b-21da-4521-a477-d4fae2bb01c1",
    "name": "Helen HR",
    "email": "helen@acme.com",
    "role": "hr_admin",
    "orgId": "c1f7b022-7f93-4a3d-b4b0-951c5dc90610",
    "active": true,
    "mustChangePassword": true
  }
  ```

### 3. `POST /org/hr-admins/promote`
Promotes an active staff member or manager to HR Admin. If the manager has direct reports, blocks with 409 Conflict until reports are reassigned.
- **Request Body**:
  ```json
  {
    "userId": "b4769032-ec2e-4632-9c1a-2895f419b4e1"
  }
  ```
- **Response (`200 OK`)**:
  ```json
  {
    "message": "User promoted to HR Admin successfully",
    "user": {
      "id": "b4769032-ec2e-4632-9c1a-2895f419b4e1",
      "name": "John Doe",
      "email": "john@acme.com",
      "role": "hr_admin"
    }
  }
  ```

### 4. `POST /org/hr-admins/:id/demote`
Demotes an HR Admin to `staff` or `manager`. Owner cannot demote himself.
- **Request Body**:
  ```json
  {
    "newRole": "staff"
  }
  ```
- **Response (`200 OK`)**:
  ```json
  {
    "message": "HR Admin demoted to staff successfully",
    "user": {
      "id": "b4769032-ec2e-4632-9c1a-2895f419b4e1",
      "name": "John Doe",
      "role": "staff"
    }
  }
  ```

### 5. `PATCH /org/hr-admins/:id/deactivate` & `PATCH /org/hr-admins/:id/reactivate`
Deactivates or reactivates an HR Admin. If target is the last active HR Admin, requires confirmation body `{ "confirmLastHr": true }`, otherwise rejects with 409 Conflict.
- **Deactivate Request Body**:
  ```json
  {
    "confirmLastHr": true
  }
  ```
- **Response (`200 OK`)**:
  ```json
  {
    "message": "HR Admin deactivated successfully",
    "user": {
      "id": "78788f4b-21da-4521-a477-d4fae2bb01c1",
      "name": "Helen HR",
      "active": false
    }
  }
  ```

### 6. `GET /org/hr-admins`
Returns paginated list of HR Admins for caller's organization.
- **Query Params**: `?page=1&limit=20&active=true`
- **Response (`200 OK`)**:
  ```json
  {
    "items": [
      {
        "id": "78788f4b-21da-4521-a477-d4fae2bb01c1",
        "name": "Helen HR",
        "email": "helen@acme.com",
        "role": "hr_admin",
        "active": true,
        "department": null,
        "joiningDate": null,
        "createdAt": "2026-11-10T09:40:00.000Z",
        "updatedAt": "2026-11-10T09:40:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20
  }
  ```

### 7. `POST /org/transfer-ownership`
Transfers tenant ownership to another active member of the organization. Strictly verifies the current owner's password first. Demotes current owner to `hr_admin` and promotes new user to `org_owner` atomically.
- **Request Body**:
  ```json
  {
    "newOwnerUserId": "78788f4b-21da-4521-a477-d4fae2bb01c1",
    "currentPassword": "OwnerSecretPassword123!"
  }
  ```
- **Response (`200 OK`)**:
  ```json
  {
    "message": "Ownership transferred successfully",
    "previousOwnerId": "e3048995-c9bf-470a-8bf8-202d088921df",
    "newOwnerId": "78788f4b-21da-4521-a477-d4fae2bb01c1"
  }
  ```

### 8. `GET /org/audit-logs`
Returns paginated, newest-first audit log entries for caller's organization (including Root operations affecting this organization).
- **Query Params**: `?page=1&limit=20&action=ORG_SETTINGS_UPDATED`
- **Response (`200 OK`)**:
  ```json
  {
    "items": [
      {
        "id": "9a93c7fe-8cf9-42b7-8d76-c22e51924619",
        "orgId": "c1f7b022-7f93-4a3d-b4b0-951c5dc90610",
        "actorId": "e3048995-c9bf-470a-8bf8-202d088921df",
        "targetUserId": null,
        "action": "ORG_SETTINGS_UPDATED",
        "reason": "Organization settings updated by owner",
        "metadata": {
          "before": { "timezone": "Asia/Kolkata" },
          "after": { "timezone": "America/New_York" }
        },
        "createdAt": "2026-11-10T09:45:00.000Z",
        "actor": {
          "id": "e3048995-c9bf-470a-8bf8-202d088921df",
          "name": "Alice Owner",
          "email": "alice@acme.com",
          "role": "org_owner"
        },
        "targetUser": null
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20
  }
  ```

---

## 👥 HR Setup: Users Management (`/users`, `@MinRole(Role.hr_admin)`)

HR Admins manage `staff` and `manager` roles within their organization. Higher privilege roles (`hr_admin`, `org_owner`, `root`) cannot be viewed or modified through these endpoints (returns 404).

### 1. `POST /users`
Creates a staff or manager user with an initial temporary password (`mustChangePassword: true`).
- **Request Body**:
  ```json
  {
    "name": "Jane Doe",
    "email": "jane.doe@acme.com",
    "role": "staff",
    "tempPassword": "TempPassword123!",
    "managerId": "e3048995-c9bf-470a-8bf8-202d088921df",
    "department": "Engineering",
    "joiningDate": "2026-05-01",
    "scheduleTemplateId": "c1f7b022-7f93-4a3d-b4b0-951c5dc90610"
  }
  ```
- **Response (`201 Created`)**:
  ```json
  {
    "id": "78788f4b-21da-4521-a477-d4fae2bb01c1",
    "orgId": "c1f7b022-7f93-4a3d-b4b0-951c5dc90610",
    "email": "jane.doe@acme.com",
    "name": "Jane Doe",
    "role": "staff",
    "managerId": "e3048995-c9bf-470a-8bf8-202d088921df",
    "department": "Engineering",
    "joiningDate": "2026-05-01T00:00:00.000Z",
    "mustChangePassword": true,
    "active": true,
    "createdAt": "2026-11-10T10:00:00.000Z",
    "updatedAt": "2026-11-10T10:00:00.000Z"
  }
  ```

### 2. `GET /users`
Paginated user listing with filters for role (`staff` or `manager`), department, active status, managerId, and search keyword.
- **Query Params**: `?page=1&limit=20&role=staff&department=Engineering&search=Jane`
- **Response (`200 OK`)**:
  ```json
  {
    "items": [
      {
        "id": "78788f4b-21da-4521-a477-d4fae2bb01c1",
        "orgId": "c1f7b022-7f93-4a3d-b4b0-951c5dc90610",
        "email": "jane.doe@acme.com",
        "name": "Jane Doe",
        "role": "staff",
        "department": "Engineering",
        "joiningDate": "2026-05-01T00:00:00.000Z",
        "active": true,
        "manager": {
          "id": "e3048995-c9bf-470a-8bf8-202d088921df",
          "name": "John Manager",
          "email": "john.manager@acme.com"
        }
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20
  }
  ```

### 3. `GET /users/:id`
Retrieves detailed profile including current active schedule template.
- **Response (`200 OK`)**:
  ```json
  {
    "id": "78788f4b-21da-4521-a477-d4fae2bb01c1",
    "orgId": "c1f7b022-7f93-4a3d-b4b0-951c5dc90610",
    "email": "jane.doe@acme.com",
    "name": "Jane Doe",
    "role": "staff",
    "department": "Engineering",
    "active": true,
    "currentScheduleTemplate": {
      "id": "c1f7b022-7f93-4a3d-b4b0-951c5dc90610",
      "name": "Standard 5-Day",
      "saturdayMode": "off"
    }
  }
  ```

### 4. `PATCH /users/:id`
Updates staff/manager attributes. If demoting a manager to staff, verifies that the manager has zero active direct reports (returns 409 if reports exist).
- **Request Body**:
  ```json
  {
    "name": "Jane Smith",
    "department": "Product Engineering"
  }
  ```

### 5. `PATCH /users/:id/deactivate` & `PATCH /users/:id/reactivate`
Soft delete / reactivation. Deactivating a manager with active reports returns 409. Revokes all active refresh tokens upon deactivation.

### 6. `POST /users/:id/reassign-reports`
Atomically reassigns all active direct reports from one manager to a new active manager.
- **Request Body**:
  ```json
  {
    "newManagerId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  }
  ```
- **Response (`200 OK`)**:
  ```json
  {
    "message": "Reports reassigned successfully",
    "reassignedCount": 3,
    "newManagerId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  }
  ```

### 7. `POST /users/:id/reset-password`
Resets password to a temporary password, forces password change upon next login, and revokes all active refresh tokens.
- **Request Body**:
  ```json
  {
    "tempPassword": "BrandNewPassword123!"
  }
  ```

### 8. `POST /users/:id/schedule` & `GET /users/:id/schedules`
Assigns a work schedule template with effective date (`POST`) and retrieves schedule assignment history (`GET`).
- **Request Body**:
  ```json
  {
    "templateId": "c1f7b022-7f93-4a3d-b4b0-951c5dc90610",
    "effectiveFrom": "2026-06-01"
  }
  ```

---

## 📅 Work Schedules (`/schedule-templates` & `/me/schedule`)

### 1. `POST /schedule-templates` (`@MinRole(Role.hr_admin)`)
Creates a schedule template with Saturday mode (`off`, `half`, `full`, `alternate`). Alternate mode strictly validates `alternateOffWeeks` (`[1, 3]` or `[2, 4]`).
- **Request Body**:
  ```json
  {
    "name": "Alternate Saturdays Off",
    "saturdayMode": "alternate",
    "alternateOffWeeks": [1, 3]
  }
  ```
- **Response (`201 Created`)**:
  ```json
  {
    "id": "f5e4d3c2-b1a0-9876-5432-10fedcba9876",
    "orgId": "c1f7b022-7f93-4a3d-b4b0-951c5dc90610",
    "name": "Alternate Saturdays Off",
    "saturdayMode": "alternate",
    "alternateOffWeeks": [1, 3],
    "active": true
  }
  ```

### 2. `GET /schedule-templates` & `GET /schedule-templates/:id` (`@MinRole(Role.hr_admin)`)
Lists schedule templates (supports `?active=true/false`) and retrieves single template details.

### 3. `PATCH /schedule-templates/:id/deactivate` (`@MinRole(Role.hr_admin)`)
Soft deactivates template. Returns 409 if currently assigned to any active employee as their latest schedule.

### 4. `GET /me/schedule` (All Authenticated Users)
Allows any logged-in user to view their current schedule and full assignment history.
- **Response (`200 OK`)**:
  ```json
  {
    "currentSchedule": {
      "id": "e8d7c6b5-a493-210f-edcb-0123456789ab",
      "effectiveFrom": "2026-05-01T00:00:00.000Z",
      "template": {
        "id": "f5e4d3c2-b1a0-9876-5432-10fedcba9876",
        "name": "Alternate Saturdays Off",
        "saturdayMode": "alternate",
        "alternateOffWeeks": [1, 3]
      }
    },
    "history": [...]
  }
  ```

### Core Engine: `ScheduleResolverService.resolveDay(userId, date)`
Resolves whether a given date is a work day or off:
- **Sunday**: Always weekly off (`weight: 0`).
- **Assigned Template**:
  - Monday–Friday: Full day (`weight: 1.0`).
  - Saturday: Evaluates mode (`off` = 0, `half` = 0.5, `full` = 1.0, `alternate` = checks `Math.ceil(dayOfMonth / 7)` in `alternateOffWeeks`).
- **Fallback**: Uses `Organization.workingDays` (default `[1, 2, 3, 4, 5]`).

---

## 🌴 Leave Types (`/leave-types`)

### 1. `POST /leave-types` (`@MinRole(Role.hr_admin)`)
Creates leave category with strict validation:
- **WFH Rule**: When `isWfh: true`, `deductsBalance` must be `false`, `daysPerYear` must be `null`, and `carryForwardMax` must be `0`.
- **Deduction Rule**: When `deductsBalance: true`, `daysPerYear` is required.
- **Carry Forward Rule**: `carryForwardMax` cannot exceed `daysPerYear`.
- **Request Body (Standard Paid Leave)**:
  ```json
  {
    "name": "Paid Leave",
    "paid": true,
    "daysPerYear": 18,
    "carryForwardMax": 6,
    "deductsBalance": true,
    "halfDayAllowed": true,
    "minNoticeDays": 2
  }
  ```
- **Request Body (Work From Home)**:
  ```json
  {
    "name": "Work From Home",
    "paid": true,
    "isWfh": true,
    "deductsBalance": false,
    "halfDayAllowed": true
  }
  ```

### 2. `GET /leave-types` & `GET /leave-types/:id` (Role-Aware Projection)
- **Staff / Manager**: Sanitized view showing only necessary application fields (`id`, `name`, `isWfh`, `deductsBalance`, `halfDayAllowed`, `minNoticeDays`).
- **HR Admin / Owner**: Full configuration view including `daysPerYear`, `monthlyLimit`, `carryForwardMax`.

### 3. `PATCH /leave-types/:id` (`@MinRole(Role.hr_admin)`)
Updates leave settings (`isWfh` is strictly immutable).

### 4. `PATCH /leave-types/:id/deactivate` & `reactivate`
Soft delete and reactivation for leave types.

---

## 🏖 Holidays (`/holidays`)

### 1. `POST /holidays` (`@MinRole(Role.hr_admin)`)
Creates a holiday. Only one holiday allowed per calendar date per tenant.
- If date is already active -> returns `409 Conflict`.
- If an inactive holiday existed on this date -> automatically reactivates and updates its name!
- **Request Body**:
  ```json
  {
    "name": "Independence Day",
    "date": "2026-08-15"
  }
  ```

### 2. `GET /holidays` (All Authenticated Users)
Returns active holidays for calendar year (defaults to current year), sorted ascending by date.
- **Query Params**: `?year=2026`

### 3. `GET /holidays/manage` (`@MinRole(Role.hr_admin)`)
Returns both active and inactive holidays across any year for administration.

### 4. `PATCH /holidays/:id` & `deactivate` & `reactivate` (`@MinRole(Role.hr_admin)`)
Updates holiday date/name, soft deactivates, or reactivates.

---

## ⚖️ Balances Module (`/balances` & `/me/balances`)

### 1. `POST /balances/allocate` (`@MinRole(Role.hr_admin)`)
Allocates annual leave balances for eligible active employees (`staff`, `manager`, `hr_admin`) across active deducts-balance leave types. Idempotent: previously allocated `(userId, leaveTypeId, year)` pairs are skipped without overwriting.
- **Request Body**:
  ```json
  {
    "year": 2026,
    "leaveTypeIds": ["c1f7b022-7f93-4a3d-b4b0-951c5dc90610"],
    "dryRun": false
  }
  ```
- **Response (`200 OK`)**:
  ```json
  {
    "created": 15,
    "skipped": 2
  }
  ```

### 2. `POST /balances/adjust` (`@MinRole(Role.hr_admin)`)
Manually adjusts an employee's allocated leave balance (positive or negative delta). Rejects with `409 Conflict` if the resulting available balance (`allocated - used - pending`) would become negative. Generates an immutable `BalanceAdjustment` audit record.
- **Request Body**:
  ```json
  {
    "userId": "78788f4b-21da-4521-a477-d4fae2bb01c1",
    "leaveTypeId": "c1f7b022-7f93-4a3d-b4b0-951c5dc90610",
    "year": 2026,
    "delta": 2.5,
    "reason": "Overtime compensatory credit"
  }
  ```
- **Response (`200 OK`)**:
  ```json
  {
    "id": "e8d7c6b5-a493-210f-edcb-0123456789ab",
    "userId": "78788f4b-21da-4521-a477-d4fae2bb01c1",
    "leaveTypeId": "c1f7b022-7f93-4a3d-b4b0-951c5dc90610",
    "year": 2026,
    "allocated": "17.5",
    "used": "0.0",
    "pending": "0.0",
    "available": "17.5",
    "adjustment": {
      "id": "a9b8c7d6-e5f4-3210-fedc-ba9876543210",
      "delta": "2.5",
      "reason": "Overtime compensatory credit",
      "createdAt": "2026-11-10T11:40:00.000Z"
    }
  }
  ```

### 3. `GET /balances` (`@MinRole(Role.hr_admin)`)
Paginated balance view with filtering by `year` (defaults to current leave year), `userId`, `leaveTypeId`, and `department`.
- **Query Params**: `?page=1&limit=20&year=2026&department=Engineering`
- **Response (`200 OK`)**:
  ```json
  {
    "items": [
      {
        "id": "e8d7c6b5-a493-210f-edcb-0123456789ab",
        "userId": "78788f4b-21da-4521-a477-d4fae2bb01c1",
        "userName": "Jane Doe",
        "userEmail": "jane.doe@acme.com",
        "department": "Engineering",
        "leaveTypeId": "c1f7b022-7f93-4a3d-b4b0-951c5dc90610",
        "leaveTypeName": "Paid Leave",
        "year": 2026,
        "allocated": "15.0",
        "used": "2.0",
        "pending": "1.0",
        "available": "12.0"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20
  }
  ```

### 4. `GET /users/:id/balances` (`@MinRole(Role.hr_admin)`)
Retrieves all balance rows and full adjustment history for a specific employee.
- **Query Params**: `?year=2026`

### 5. `GET /me/balances` (All Authenticated Users)
Returns personal leave entitlement for all active leave types. For types with `monthlyLimit` (e.g. WFH), computes `usedThisMonth` from `LeaveSegmentDay` entries with status `pending` or `approved`.
- **Response (`200 OK`)**:
  ```json
  {
    "year": 2026,
    "items": [
      {
        "leaveTypeId": "c1f7b022-7f93-4a3d-b4b0-951c5dc90610",
        "leaveTypeName": "Paid Leave",
        "isWfh": false,
        "deductsBalance": true,
        "allocated": "15.0",
        "used": "2.0",
        "pending": "1.0",
        "available": "12.0",
        "monthlyLimit": null,
        "usedThisMonth": null
      },
      {
        "leaveTypeId": "b2a1c098-7654-3210-fedc-ba9876543210",
        "leaveTypeName": "Work From Home",
        "isWfh": true,
        "deductsBalance": false,
        "allocated": null,
        "used": null,
        "pending": null,
        "available": null,
        "monthlyLimit": "4.0",
        "usedThisMonth": "0.0"
      }
    ]
  }
  ```

### 6. `POST /balances/carry-forward/preview` & `/run` (`@MinRole(Role.hr_admin)`)
- **Preview**: Previews carry forward calculations capped by `carryForwardMax` on `available` (`allocated - used - pending`). Flags `toYear allocation missing` and counts pending warnings.
- **Run**: Atomically increments `toYear.allocated += carry`, creates `BalanceAdjustment` ("Carry-forward from {fromYear}"), and records `CarryForwardRun`. Rejects with `409 Conflict` if rerun or if any eligible employee is missing a `toYear` allocation.
- **Request Body**:
  ```json
  {
    "fromYear": 2025
  }
  ```
- **Response (`200 OK`)**:
  ```json
  {
    "message": "Carry-forward executed successfully",
    "fromYear": 2025,
    "toYear": 2026,
    "totalRows": 12,
    "totalDays": "48.5"
  }
  ```

### 7. Balance Primitives (Transaction Safe Engine)
Atomic SQL primitives designed for concurrent leave request management:
- `reserve(tx, userId, leaveTypeId, year, days)`: Atomic UPDATE `pending += days` WHERE `(allocated - used - pending) >= days`.
- `release(tx, userId, leaveTypeId, year, days)`: Atomic UPDATE `pending = GREATEST(0, pending - days)`.
- `commit(tx, userId, leaveTypeId, year, days)`: Atomic UPDATE `pending = GREATEST(0, pending - days), used += days`.
- `refund(tx, userId, leaveTypeId, year, days)`: Atomic UPDATE `used = GREATEST(0, used - days)`.

---

## 📅 Leave Requests Module (`/leave-requests`)

The Leave Request Engine handles atomic validation, breakdown calculation, balance reservation, and concurrency serialization for employee leaves and work-from-home requests.

### Key Rules & Behaviors
- **Advisory Lock Concurrency**: Submissions acquire a transaction-scoped PostgreSQL advisory lock (`pg_advisory_xact_lock(hashtextextended('leave:' || userId, 0::bigint))`), cleanly serializing concurrent submissions per user without race conditions.
- **Calendar Date Integrity**: Dates are parsed and formatted as ISO plain calendar dates (`"YYYY-MM-DD"`) in UTC without timezone displacement.
- **Role Restrictions**: Accessible to `staff`, `manager`, and `hr_admin`. `org_owner` and `root` receive 403 (`"Owner leave apply nahi karta"`).
- **Validation Codes**: Returns `{ statusCode, code, message, details }` with codes: `INVALID_SEGMENT`, `LEAVE_TYPE_INACTIVE`, `HALF_DAY_NOT_ALLOWED`, `ZERO_COUNTED_DAYS`, `BACKDATE_NOT_ALLOWED`, `MIN_NOTICE`, `OVERLAP`, `NO_BALANCE`, `INSUFFICIENT_BALANCE`, `MONTHLY_LIMIT_EXCEEDED`.
- **Hybrid Requests**: A single request can mix multiple segments across different leave types (e.g., Casual Leave and WFH) in one atomic transaction.

---

### 1. `POST /leave-requests`
Submits a leave request atomically inside a transaction with advisory lock. Validates schedule, holidays, backdates, notice periods, internal/external overlaps, monthly limits, and reserves balance via `BalancesService.reserve()`.

- **Request Body**:
  ```json
  {
    "reason": "Family function and remote work",
    "segments": [
      {
        "leaveTypeId": "422e1713-cfec-4cbb-9c29-37f00bf7553b",
        "startDate": "2026-11-11",
        "endDate": "2026-11-11",
        "portion": "full"
      },
      {
        "leaveTypeId": "bf9652a2-cb07-4222-9cb7-6ea7d8c6b25f",
        "startDate": "2026-11-12",
        "endDate": "2026-11-13",
        "portion": "full"
      }
    ]
  }
  ```

- **Response (`201 Created`)**:
  ```json
  {
    "id": "e604f86d-66e8-4a6c-9a4c-d90c74fbcf79",
    "orgId": "c1f7b022-7f93-4a3d-b4b0-951c5dc90610",
    "userId": "20bca24f-f68e-4545-9876-e52c1f7ebc22",
    "createdBy": "20bca24f-f68e-4545-9876-e52c1f7ebc22",
    "reason": "Family function and remote work",
    "status": "pending",
    "spanDays": 3,
    "countedDays": "3.0",
    "createdAt": "2026-11-10T12:20:00.000Z",
    "segments": [
      {
        "id": "787c938d-0fba-45cb-9c17-48f1d8c1c4ba",
        "leaveTypeId": "422e1713-cfec-4cbb-9c29-37f00bf7553b",
        "leaveType": {
          "id": "422e1713-cfec-4cbb-9c29-37f00bf7553b",
          "name": "Casual Leave",
          "isWfh": false
        },
        "startDate": "2026-11-11T00:00:00.000Z",
        "endDate": "2026-11-11T00:00:00.000Z",
        "portion": "full",
        "countedDays": "1.0"
      },
      {
        "id": "cb1c34a2-9fa0-482d-8f24-5fa065ef84b0",
        "leaveTypeId": "bf9652a2-cb07-4222-9cb7-6ea7d8c6b25f",
        "leaveType": {
          "id": "bf9652a2-cb07-4222-9cb7-6ea7d8c6b25f",
          "name": "Work From Home",
          "isWfh": true
        },
        "startDate": "2026-11-12T00:00:00.000Z",
        "endDate": "2026-11-13T00:00:00.000Z",
        "portion": "full",
        "countedDays": "2.0"
      }
    ],
    "segmentDays": [
      {
        "id": "01bcf52e-5f9a-4c28-98e3-5a0f8ebc7610",
        "date": "2026-11-11T00:00:00.000Z",
        "occupancy": "1.0",
        "countedWeight": "1.0",
        "skipReason": "none"
      },
      {
        "id": "02bcf52e-5f9a-4c28-98e3-5a0f8ebc7611",
        "date": "2026-11-12T00:00:00.000Z",
        "occupancy": "1.0",
        "countedWeight": "1.0",
        "skipReason": "none"
      },
      {
        "id": "03bcf52e-5f9a-4c28-98e3-5a0f8ebc7612",
        "date": "2026-11-13T00:00:00.000Z",
        "occupancy": "1.0",
        "countedWeight": "1.0",
        "skipReason": "none"
      }
    ]
  }
  ```

---

### 2. `POST /leave-requests/preview`
Performs identical validation, segment calculations, and balance checks without locking, database commits, or reserving balances.

- **Request Body**: Same as `POST /leave-requests`.
- **Response (`200 OK`)**:
  ```json
  {
    "spanDays": 3,
    "countedDays": 3,
    "segments": [
      {
        "leaveTypeId": "422e1713-cfec-4cbb-9c29-37f00bf7553b",
        "leaveTypeName": "Casual Leave",
        "startDate": "2026-11-11",
        "endDate": "2026-11-11",
        "portion": "full",
        "countedDays": 1
      },
      {
        "leaveTypeId": "bf9652a2-cb07-4222-9cb7-6ea7d8c6b25f",
        "leaveTypeName": "Work From Home",
        "startDate": "2026-11-12",
        "endDate": "2026-11-13",
        "portion": "full",
        "countedDays": 2
      }
    ],
    "breakdown": [
      {
        "date": "2026-11-11",
        "leaveTypeId": "422e1713-cfec-4cbb-9c29-37f00bf7553b",
        "leaveTypeName": "Casual Leave",
        "portion": "full",
        "occupancy": 1,
        "countedWeight": 1,
        "skipReason": "none"
      },
      {
        "date": "2026-11-12",
        "leaveTypeId": "bf9652a2-cb07-4222-9cb7-6ea7d8c6b25f",
        "leaveTypeName": "Work From Home",
        "portion": "full",
        "occupancy": 1,
        "countedWeight": 1,
        "skipReason": "none"
      },
      {
        "date": "2026-11-13",
        "leaveTypeId": "bf9652a2-cb07-4222-9cb7-6ea7d8c6b25f",
        "leaveTypeName": "Work From Home",
        "portion": "full",
        "occupancy": 1,
        "countedWeight": 1,
        "skipReason": "none"
      }
    ]
  }
  ```

---

### 3. `GET /leave-requests/mine`
Returns paginated personal request history with status and date range overlap filtering.

- **Query Params**: `?page=1&limit=20&status=pending&from=2026-11-01&to=2026-11-30`
- **Response (`200 OK`)**:
  ```json
  {
    "items": [
      {
        "id": "e604f86d-66e8-4a6c-9a4c-d90c74fbcf79",
        "reason": "Family function and remote work",
        "status": "pending",
        "spanDays": 3,
        "countedDays": "3.0",
        "createdAt": "2026-11-10T12:20:00.000Z",
        "decidedAt": null,
        "decisionComment": null,
        "decidedBy": null,
        "segments": [
          {
            "id": "787c938d-0fba-45cb-9c17-48f1d8c1c4ba",
            "leaveTypeId": "422e1713-cfec-4cbb-9c29-37f00bf7553b",
            "leaveTypeName": "Casual Leave",
            "isWfh": false,
            "startDate": "2026-11-11",
            "endDate": "2026-11-11",
            "portion": "full",
            "countedDays": "1.0"
          }
        ]
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20
  }
  ```

---

### 4. `GET /leave-requests/:id`
Returns complete request details including segments and breakdown.
- **Authorization**: Accessible to the requester (`owner`) or `HR_ADMIN+` in the caller's organization. All other staff, managers, or cross-tenant users receive a 404.
- **Response (`200 OK`)**:
  ```json
  {
    "id": "e604f86d-66e8-4a6c-9a4c-d90c74fbcf79",
    "userId": "20bca24f-f68e-4545-9876-e52c1f7ebc22",
    "reason": "Family function and remote work",
    "status": "pending",
    "spanDays": 3,
    "countedDays": "3.0",
    "createdAt": "2026-11-10T12:20:00.000Z",
    "decidedAt": null,
    "decisionComment": null,
    "decidedBy": null,
    "cancelledAt": null,
    "segments": [
      {
        "id": "787c938d-0fba-45cb-9c17-48f1d8c1c4ba",
        "leaveTypeId": "422e1713-cfec-4cbb-9c29-37f00bf7553b",
        "leaveTypeName": "Casual Leave",
        "isWfh": false,
        "startDate": "2026-11-11",
        "endDate": "2026-11-11",
        "portion": "full",
        "countedDays": "1.0"
      }
    ],
    "segmentDays": [
      {
        "id": "01bcf52e-5f9a-4c28-98e3-5a0f8ebc7610",
        "date": "2026-11-11",
        "leaveTypeId": "422e1713-cfec-4cbb-9c29-37f00bf7553b",
        "occupancy": "1.0",
        "countedWeight": "1.0",
        "skipReason": "none"
      }
    ]
  }
  ```

---

### 5. `POST /leave-requests/:id/cancel`
Cancels a personal pending request and releases any reserved balances back to the user's available balance via `BalancesService.release()`.
- **Authorization**: Only the owner of the request can cancel it. Non-owners receive 404. Non-pending requests (approved, rejected, or already cancelled) receive 409 (`CANNOT_CANCEL_REQUEST`).
- **Response (`200 OK`)**:
  ```json
  {
    "message": "Leave request cancelled successfully",
    "id": "e604f86d-66e8-4a6c-9a4c-d90c74fbcf79",
    "status": "cancelled"
  }
  ```

---

### 6. Sample Error Response: 409 Conflict (`OVERLAP`)
When a submitted segment collides with an existing active request (pending or approved), the system pinpoints the conflicting dates, cites existing request IDs, and suggests the earliest available date:

- **Response (`409 Conflict`)**:
  ```json
  {
    "statusCode": 409,
    "code": "OVERLAP",
    "message": "2026-11-05 se 2026-11-06 pehle se doosri request mein hai. Aap 2026-11-07 se apply kar sakte ho.",
    "details": {
      "conflicts": [
        {
          "requestId": "61a10bb8-5cbc-4051-987a-627eaf8457fb",
          "startDate": "2026-11-02",
          "endDate": "2026-11-06",
          "overlappingDates": [
            "2026-11-05",
            "2026-11-06"
          ]
        }
      ],
      "nextFreeDate": "2026-11-07"
    }
  }
  ```

---

## ⚖️ Approvals & On-Behalf Module

### 🛡️ Decision Permission Rule (`canDecide(caller, requester)`)
- **Self-Decision Blocked**: A user can never approve, reject, or cancel their own request (HTTP 403).
- **HR Admin Requester**: When the requester has role `hr_admin`, **only** `org_owner` (or root) can decide (HTTP 403 for other HR Admins).
- **Staff / Manager Requester**: Either `hr_admin` or `org_owner` can decide.
- **Staff / Manager Caller**: Regular staff and managers cannot access any approval endpoints (HTTP 403).

---

### Approvals Endpoints (`/approvals`, `@MinRole(Role.hr_admin)`)

#### 1. `GET /approvals/pending`
Returns paginated list of pending requests filtered by caller authority, ordered oldest first (`createdAt: 'asc'`).
- `hr_admin` sees requests submitted by `staff` and `manager`.
- `org_owner` sees requests from `staff`, `manager`, and `hr_admin`.
- Query parameter `?onlyHrAdmins=true` (available to `org_owner`) filters exclusively for HR Admin leave requests.
- Additional query filters: `userId`, `department`, `leaveTypeId`, `from`, `to` (date range overlap).

- **Response (`200 OK`)**:
  ```json
  {
    "items": [
      {
        "id": "7bfa602a-3507-4e31-8f67-a2f0c1110b91",
        "requester": {
          "id": "e3048995-c9bf-470a-8bf8-202d088921df",
          "name": "John Doe",
          "role": "staff",
          "department": "Engineering"
        },
        "segments": [
          {
            "id": "99f8d5cf-61e8-4669-95e2-2252a17be1f0",
            "leaveTypeId": "12903e05-df3c-482d-862d-0a2569ffca86",
            "leaveTypeName": "Casual Leave",
            "isWfh": false,
            "startDate": "2026-11-20",
            "endDate": "2026-11-20",
            "portion": "full",
            "countedDays": 1
          }
        ],
        "reason": "Family function",
        "spanDays": 1,
        "countedDays": 1,
        "createdAt": "2026-11-19T09:40:00.000Z",
        "createdBy": null
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20
  }
  ```

#### 2. `GET /approvals/:id`
Retrieves full details of a pending request along with complete decision context:
- **`balances`**: Breakdown of all `deductsBalance` leave types involved in this request for the relevant financial leave years (`allocated`, `used`, `pending`, `available`).
- **`monthlyUsage`**: Current monthly limit and usage for leave types with `monthlyLimit` (e.g. WFH caps) in the requested month (`monthlyLimit`, `usedThisMonth`).
- **`teamConflicts`**: Other team members on leave or WFH on overlapping dates (both approved and pending status, with leave type name). Team is determined by same `managerId` (plus manager), or same department if no manager.
- If request does not exist, belongs to another organization, or caller lacks authority to decide (`canDecide` check), returns HTTP 404.

- **Response (`200 OK`)**:
  ```json
  {
    "id": "7bfa602a-3507-4e31-8f67-a2f0c1110b91",
    "status": "pending",
    "reason": "Personal work",
    "spanDays": 2,
    "countedDays": 2,
    "requester": {
      "id": "e3048995-c9bf-470a-8bf8-202d088921df",
      "name": "John Doe",
      "email": "john@acme.com",
      "role": "staff",
      "department": "Engineering"
    },
    "segments": [
      {
        "id": "99f8d5cf-61e8-4669-95e2-2252a17be1f0",
        "leaveTypeId": "12903e05-df3c-482d-862d-0a2569ffca86",
        "leaveTypeName": "Casual Leave",
        "startDate": "2026-11-20",
        "endDate": "2026-11-21",
        "portion": "full",
        "countedDays": 2
      }
    ],
    "context": {
      "balances": [
        {
          "leaveTypeId": "12903e05-df3c-482d-862d-0a2569ffca86",
          "leaveTypeName": "Casual Leave",
          "year": 2026,
          "allocated": 12,
          "used": 3,
          "pending": 2,
          "available": 7
        }
      ],
      "monthlyUsage": [
        {
          "leaveTypeId": "a823f990-11b2-4d56-8ac0-23a9d901f441",
          "leaveTypeName": "Work From Home",
          "month": "2026-11",
          "monthlyLimit": 4,
          "usedThisMonth": 2
        }
      ],
      "teamConflicts": [
        {
          "userId": "b51a0ff1-523e-4d43-a6d1-efd58dca9a78",
          "userName": "Alice Colleague",
          "department": "Engineering",
          "date": "2026-11-20",
          "leaveTypeName": "Work From Home",
          "isWfh": true,
          "status": "approved"
        }
      ]
    }
  }
  ```

#### 3. `POST /approvals/:id/approve`
Approves a pending leave request atomically under requester advisory lock.
- Transitions status to `approved`, stamps `decidedBy`, `decidedAt`, and optional `decisionComment`.
- Atomically commits balance from `pending` to `used` via `BalancesService.commit`.
- Emits `LEAVE_APPROVED` audit log entry with `requestId`, `requesterId`, and `countedDays`.
- If request is not in `pending` status (already decided or cancelled), returns HTTP 409 Conflict.
- **Request Body**:
  ```json
  {
    "comment": "Approved. Have a good break!"
  }
  ```
- **Response (`200 OK`)**:
  ```json
  {
    "message": "Leave request approved successfully",
    "requestId": "7bfa602a-3507-4e31-8f67-a2f0c1110b91",
    "status": "approved"
  }
  ```

#### 4. `POST /approvals/:id/reject`
Rejects a pending leave request with a mandatory comment.
- Transitions status to `rejected`, stamps `decidedBy`, `decidedAt`, and mandatory `decisionComment`.
- Atomically releases reserved balance via `BalancesService.release` (`pending -> available`).
- Emits `LEAVE_REJECTED` audit log entry with `requestId`, `requesterId`, and `countedDays`.
- Frees dates so requester can re-apply. Once rejected, request is final (no override).
- **Request Body**:
  ```json
  {
    "comment": "Team has high release workload during this sprint."
  }
  ```
- **Response (`200 OK`)**:
  ```json
  {
    "message": "Leave request rejected successfully",
    "requestId": "7bfa602a-3507-4e31-8f67-a2f0c1110b91",
    "status": "rejected"
  }
  ```

---

### On-Behalf & Admin Leave Management (`/leave-requests`, `@MinRole(Role.hr_admin)`)

#### 5. `POST /leave-requests/on-behalf`
Enables HR Admin or Org Owner to apply leave on behalf of a team member.
- Bypasses minimum notice period and backdate constraints.
- Re-uses core validation engine (`createRequest`): checks overlaps, balance sufficiency, monthly limits, and active leave types under requester advisory lock.
- Enforces `canDecide`: HR Admin cannot apply on behalf of another HR Admin (only Org Owner can).
- Supports `autoApprove: true` (default): directly commits balance and sets status to `approved`. When `autoApprove: false`, creates a `pending` request in approvals queue.
- Emits `LEAVE_APPLIED_ON_BEHALF` audit log entry.
- **Request Body**:
  ```json
  {
    "userId": "e3048995-c9bf-470a-8bf8-202d088921df",
    "reason": "Emergency medical leave",
    "onBehalfReason": "Employee called in hospital emergency",
    "autoApprove": true,
    "segments": [
      {
        "leaveTypeId": "12903e05-df3c-482d-862d-0a2569ffca86",
        "startDate": "2026-11-10",
        "endDate": "2026-11-12",
        "portion": "full"
      }
    ]
  }
  ```
- **Response (`201 Created`)**:
  ```json
  {
    "id": "b3e0c092-23c7-4581-9b16-92f703ad8d7c",
    "status": "approved",
    "spanDays": 3,
    "countedDays": 3,
    "autoApproved": true
  }
  ```

#### 6. `POST /leave-requests/:id/cancel-approved`
Allows HR Admin to cancel an already approved leave request.
- Mandatory `reason` explaining the administrative cancellation.
- Atomically refunds balance from `used` back to available via `BalancesService.refund`.
- Preserves original `decisionComment` for auditability, sets `cancelledAt` and updates status to `cancelled`.
- Frees dates for subsequent applications.
- Emits `LEAVE_CANCELLED_BY_HR` audit log entry.
- Returns HTTP 409 if request is not currently in `approved` status. Caller cannot cancel their own approved leave (HTTP 403).
- **Request Body**:
  ```json
  {
    "reason": "Employee reported back early due to postponed event"
  }
  ```
- **Response (`200 OK`)**:
  ```json
  {
    "message": "Approved leave request cancelled and balance refunded successfully",
    "requestId": "b3e0c092-23c7-4581-9b16-92f703ad8d7c",
    "status": "cancelled"
  }
  ```

#### 7. `GET /leave-requests`
Org-wide leave history for HR Admins and Org Owners with comprehensive filtering and pagination.
- **Query Params**: `?page=1&limit=20&userId=...&department=Engineering&leaveTypeId=...&status=approved&from=2026-11-01&to=2026-11-30`
- **Response (`200 OK`)**:
  ```json
  {
    "items": [
      {
        "id": "b3e0c092-23c7-4581-9b16-92f703ad8d7c",
        "requester": {
          "id": "e3048995-c9bf-470a-8bf8-202d088921df",
          "name": "John Doe",
          "role": "staff",
          "department": "Engineering"
        },
        "status": "approved",
        "reason": "Emergency medical leave",
        "onBehalfReason": "Employee called in hospital emergency",
        "spanDays": 3,
        "countedDays": 3,
        "createdAt": "2026-11-19T09:40:00.000Z",
        "decidedAt": "2026-11-19T09:40:00.000Z",
        "decidedBy": "HR Admin",
        "decisionComment": "Applied on behalf with auto-approval"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20
  }
  ```

---

### 🔄 User Deactivation Hook
When a user is deactivated (via `PATCH /users/:id/deactivate` or `PATCH /org/hr-admins/:id/deactivate`):
1. All pending leave requests of the deactivated user are automatically cancelled (`status: cancelled`).
2. Reserved balances for all pending requests are released back to available balance via `BalancesService.release`.
3. Already approved leaves remain intact for historical attendance and payroll accuracy.
4. Emits `LEAVE_AUTO_CANCELLED` audit log entry with list of affected `requestIds` and total days released.

---

## 🛡️ Global Security: OrgScopeGuard (Root Platform Boundary)

- **Platform vs Tenant Isolation**: `Role.root` is a platform-level identity (`orgId === null`).
- **Allowed Routes for Root**: `/platform/*`, `/auth/*`, `/health`.
- **Tenant Scope Enforcement**: Any request by a `root` user to tenant/org endpoints (such as `/approvals/*`, `/users/*`, `/leave-requests/*`, `/dashboard/*`, `/reports/*`, `/team/*`, `/my-team/*`) is immediately rejected with HTTP 403:
  ```json
  {
    "statusCode": 403,
    "message": "Root org ke andar kaam nahi karta",
    "error": "Forbidden"
  }
  ```
- **Platform Route Protection**: Any authenticated non-root user attempting to access `/platform/*` routes is rejected with HTTP 403 (`"Insufficient permissions"`).

---

## 👥 Team Availability & My Team (`/team` & `/my-team`)

### Day Types & Dynamic Work Schedule Resolution
Availability views evaluate each employee's live work schedule and active organization holidays to determine precise day types rather than assuming a static Monday-Friday working week.
- **Individual Schedule History**: Evaluates the latest `EmployeeSchedule` effective on or before each date, resolving schedule templates (`saturdayMode`: `off`, `half`, `full`, or `alternate` with `alternateOffWeeks` like `[1, 3]` or `[2, 4]`).
- **Organization Fallback**: Employees without an assigned schedule template fall back to the organization's configured `workingDays` array (default `[1, 2, 3, 4, 5]`).
- **Sunday Rule**: Sunday (day 0) is universally resolved as a weekly off (`weight: 0`) across all templates.
- **Organization Holidays**: Active holidays in the date range mark the day as non-working for all tenant employees.
- **Batch Resolution Efficiency**: Powered by `ScheduleResolverService.resolveRangeForUsers(orgId, userIds, from, to)`, resolving all employee schedules, templates, holidays, and org working days in a single database round-trip (zero N+1 queries).

### Strict Privacy & Information Redaction
- Sensitive leave and schedule details are never exposed to team peers or managers.
- **Allowed Member Fields**: `userId`, `name`, `department`, `offDates`, `halfDates`, `segments` (in range endpoints); `userId`, `name`, `department`, `status`, `portion`, `halfDay` (in today endpoints).
- **Strictly Redacted**: `reason`, `leaveTypeId`, `leaveTypeName`, `balance`, `scheduleTemplateId`, `templateName`, `saturdayMode`, `alternateOffWeeks` are strictly excluded from queries and responses.
- **Filtering**: Only approved leave segments are included. Pending, rejected, and cancelled requests are excluded. Date ranges are clipped to `[from, to]`. Inactive users are excluded; active members with no leave in range are returned with `segments: []`.
- **Date Range Constraints**: `from` and `to` (YYYY-MM-DD), `from <= to`, and maximum range of **92 days** (returns 400 Bad Request if exceeded).

### 💡 Frontend Integration Guide

#### 1. Mutually Exclusive Member Status Values (`/availability/today`)
Every team member has exactly one top-level `status` on any given day:
1. **`"off"`**: The day is non-working for this member (Sunday, Organization Holiday, or Employee Weekly Off / Alternate Saturday Off).
   > **Note on Leaves on Off Days**: If an employee has an approved leave segment covering a non-working day, their status is still shown as `"off"` and they are **not** counted in `counts.onLeave`. This prevents non-working days from artificially inflating active leave counts.
2. **`"leave"`**: The employee has an approved leave on this working day. Includes `"portion"` (`"full"`, `"first_half"`, `"second_half"`).
3. **`"wfh"`**: The employee has an approved Work From Home segment on this working day. Includes `"portion"` (`"full"`, `"first_half"`, `"second_half"`).
4. **`"available"`**: The employee is scheduled to work and has no approved leave/WFH.
   - If **`halfDay: true`**: The employee's standard schedule for today is a half-day shift (`weight: 0.5`, e.g., Saturday half-day mode). The UI can display a half-day badge or indicator.

#### 2. Single Counting Invariance
```text
counts.total === counts.onLeave + counts.wfh + counts.available + counts.off
```

#### 3. Range Calendar Badging (`/availability`)
- **`holidays`**: Array of `{ date, name }` objects at the top level for holidays falling within the requested range.
- **`offDates`**: Sorted array of dates (`YYYY-MM-DD`) where the member is not scheduled to work (Sundays, Org Holidays, or weekly offs).
- **`halfDates`**: Sorted array of dates (`YYYY-MM-DD`) where the member's regular shift is a half-day (Saturday half, non-holiday).
- **`segments`**: Approved leave/WFH ranges clipped to the queried window.

---

### Endpoints

#### 1. `GET /team/availability` (`@MinRole(Role.manager)`)
Returns range availability for the caller's direct reports (`managerId = caller.id`).
- **Query Params**: `?from=2026-11-01&to=2026-11-14`
- **Response (`200 OK`)**:
  ```json
  {
    "holidays": [
      {
        "date": "2026-11-11",
        "name": "Diwali"
      }
    ],
    "members": [
      {
        "userId": "e3048995-c9bf-470a-8bf8-202d088921df",
        "name": "Alice Developer",
        "department": "Engineering",
        "offDates": [
          "2026-11-01",
          "2026-11-07",
          "2026-11-08",
          "2026-11-11",
          "2026-11-14"
        ],
        "halfDates": [],
        "segments": [
          {
            "kind": "leave",
            "startDate": "2026-11-02",
            "endDate": "2026-11-04",
            "portion": "full"
          }
        ]
      },
      {
        "userId": "b51a0ff1-523e-4d43-a6d1-efd58dca9a78",
        "name": "Bob Designer (Saturday Half-Day Schedule)",
        "department": "Engineering",
        "offDates": [
          "2026-11-01",
          "2026-11-08",
          "2026-11-11"
        ],
        "halfDates": [
          "2026-11-07",
          "2026-11-14"
        ],
        "segments": []
      }
    ]
  }
  ```

#### 2. `GET /team/availability/today` (`@MinRole(Role.manager)`)
Single-day availability and day-type status for caller's direct reports for today (`ClockService.today(org.timezone)`).
- **Saturday Resolution Scenarios Example**:
  On Saturday, 7 November 2026 (1st Saturday of the month):
  - User A (Saturday Off): `status: "off"`
  - User B (Saturday Half): `status: "available"`, `halfDay: true`
  - User C (Saturday Full): `status: "available"`
  - User D (Alternate 1st & 3rd Off): `status: "off"` (Week 1 Saturday)
  - User E (Alternate 2nd & 4th Off): `status: "available"` (Week 1 Saturday is working)
  - User F (Default 5-day Org Fallback): `status: "off"`
- **Response (`200 OK`)**:
  ```json
  {
    "date": "2026-11-07",
    "dayInfo": {
      "isHoliday": false,
      "holidayName": null
    },
    "counts": {
      "onLeave": 0,
      "wfh": 0,
      "available": 3,
      "off": 3,
      "total": 6
    },
    "members": [
      {
        "userId": "11111111-1111-1111-1111-111111111111",
        "name": "User A (Saturday Off)",
        "department": "Engineering",
        "status": "off"
      },
      {
        "userId": "22222222-2222-2222-2222-222222222222",
        "name": "User B (Saturday Half)",
        "department": "Engineering",
        "status": "available",
        "halfDay": true
      },
      {
        "userId": "33333333-3333-3333-3333-333333333333",
        "name": "User C (Saturday Full)",
        "department": "Engineering",
        "status": "available"
      },
      {
        "userId": "44444444-4444-4444-4444-444444444444",
        "name": "User D (Alternate 1st & 3rd)",
        "department": "Engineering",
        "status": "off"
      },
      {
        "userId": "55555555-5555-5555-5555-555555555555",
        "name": "User E (Alternate 2nd & 4th)",
        "department": "Engineering",
        "status": "available"
      },
      {
        "userId": "66666666-6666-6666-6666-666666666666",
        "name": "User F (Org Default 5-day)",
        "department": "Engineering",
        "status": "off"
      }
    ]
  }
  ```

#### 3. `GET /my-team/availability` (All Logged-in Tenant Users)
Team availability view accessible to all organization members:
- **Staff**: Peers reporting to the same manager (excluding caller) + caller's manager. Enables staff to see their manager's approved leaves!
- **Manager**: Direct reports.
- **HR Admin / Org Owner**: Direct reports if any, or peers reporting to their manager.
- **Unassigned Staff (no manager)**: Returns `{ holidays: [], members: [] }`.
- **Query Params**: `?from=2026-11-01&to=2026-11-14`
- **Response (`200 OK`)**: Same privacy-redacted `{ holidays, members }` response format as `/team/availability`.

#### 4. `GET /my-team/availability/today` (All Logged-in Tenant Users)
Today's team availability status and counts for the caller's team.
- **Response (`200 OK`)**: Same `{ date, dayInfo, counts, members }` response format as `/team/availability/today`.

---

## 📊 HR Calendar & Reports (`/reports`, `@MinRole(Role.hr_admin)`)

### CSV Export & Formula Injection Prevention
- All report endpoints support `?format=csv`.
- **Headers**: `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="<report-name>-<date>.csv"`.
- **UTF-8 BOM**: Prefixed with `\uFEFF` for seamless Excel / LibreOffice rendering.
- **Formula Injection Mitigation**: Any cell starting with `=, +, -, @` is automatically prepended with a single quote (`'`).
- **Escaping**: Standard CSV quoting and double-quote escaping (`"` -> `""`).
- **Limit**: Enforces maximum of 10,000 rows in CSV mode (throws 400 Bad Request if exceeded).

### Endpoints

#### 1. `GET /reports/calendar`
Org-wide calendar of leave segments.
- **Query Params**: `?from=2026-11-01&to=2026-11-30&department=Engineering&userId=...&includePending=true&page=1&limit=20`
- Full HR details: user name, department, leave type name, `isWfh`, clipped start/end dates, portion, reason, and status.
- **Response (`200 OK`)**:
  ```json
  {
    "items": [
      {
        "id": "7bfa602a-3507-4e31-8f67-a2f0c1110b91",
        "userId": "e3048995-c9bf-470a-8bf8-202d088921df",
        "userName": "Alice Developer",
        "department": "Engineering",
        "leaveTypeId": "12903e05-df3c-482d-862d-0a2569ffca86",
        "leaveTypeName": "Sick Leave",
        "isWfh": false,
        "portion": "full",
        "startDate": "2026-11-05",
        "endDate": "2026-11-06",
        "reason": "Viral fever recovery",
        "status": "approved"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20
  }
  ```

#### 2. `GET /reports/on-leave`
Lists employees on leave or WFH for a specific date (defaults to today in org timezone).
- **Query Params**: `?date=2026-11-15`
- **Response (`200 OK`)**:
  ```json
  {
    "date": "2026-11-15",
    "items": [
      {
        "userId": "e3048995-c9bf-470a-8bf8-202d088921df",
        "userName": "Alice Developer",
        "department": "Engineering",
        "leaveTypeName": "Sick Leave",
        "isWfh": false,
        "portion": "full",
        "status": "leave"
      }
    ]
  }
  ```

#### 3. `GET /reports/balance-summary`
Aggregates employee leave balances by year with department and leave type subtotals.
- Max 5,000 rows (throws 400 Bad Request with filter recommendation if exceeded).
- **Query Params**: `?year=2026&department=Engineering&leaveTypeId=...`
- **Response (`200 OK`)**:
  ```json
  {
    "year": 2026,
    "rows": [
      {
        "userId": "e3048995-c9bf-470a-8bf8-202d088921df",
        "userName": "Alice Developer",
        "department": "Engineering",
        "leaveTypeId": "12903e05-df3c-482d-862d-0a2569ffca86",
        "leaveTypeName": "Earned Leave",
        "year": 2026,
        "allocated": 15,
        "used": 3,
        "pending": 2,
        "available": 10
      }
    ],
    "totals": {
      "byDepartment": [
        {
          "department": "Engineering",
          "allocated": 15,
          "used": 3,
          "pending": 2,
          "available": 10
        }
      ],
      "byLeaveType": [
        {
          "leaveTypeId": "12903e05-df3c-482d-862d-0a2569ffca86",
          "leaveTypeName": "Earned Leave",
          "allocated": 15,
          "used": 3,
          "pending": 2,
          "available": 10
        }
      ]
    }
  }
  ```

#### 4. `GET /reports/utilization`
Calculates approved leave utilization (sum of `countedWeight`, working days only) grouped by `department`, `leaveType`, or `user`.
- For `department`, includes `headcount` and `perEmployeeAverage` (`days / headcount`). Half-days are counted as 0.5.
- **Query Params**: `?from=2026-11-01&to=2026-11-30&groupBy=department`
- **Response (`200 OK`)**:
  ```json
  {
    "from": "2026-11-01",
    "to": "2026-11-30",
    "groupBy": "department",
    "items": [
      {
        "department": "Engineering",
        "days": 12.5,
        "headcount": 10,
        "perEmployeeAverage": 1.25
      }
    ]
  }
  ```

- **CSV Sample (`?format=csv`)**:
  ```csv
  ﻿User Name,Department,Leave Type,Is WFH,Portion,Start Date,End Date,Reason,Status
  Alice Developer,Engineering,Earned Leave,No,full,2026-11-05,2026-11-06,Vacation,approved
  Bob Smith,'+Finance,Casual Leave,No,first_half,2026-11-10,2026-11-10,'@emergency,approved
  ```

---

## 📈 Dashboards (`/dashboard`)

Data returned is scoped according to caller's permissions and role:

### 1. `GET /dashboard/me` (Staff, Manager, HR Admin, Org Owner)
Personal overview:
- `balances`: Current leave year balances (`allocated`, `used`, `pending`, `available`, and `usedThisMonth` for types with `monthlyLimit`). Empty for Org Owner.
- `upcomingLeaves`: Approved leaves in the next 30 days. Empty for Org Owner.
- `pendingRequests`: Count and list of caller's pending requests.
- `upcomingHolidays`: Next 3 holidays from today.
- **Response (`200 OK`)**:
  ```json
  {
    "balances": [
      {
        "leaveTypeId": "12903e05-df3c-482d-862d-0a2569ffca86",
        "leaveTypeName": "Casual Leave",
        "isWfh": false,
        "year": 2026,
        "allocated": 12,
        "used": 2,
        "pending": 1,
        "available": 9,
        "monthlyLimit": 4,
        "usedThisMonth": 2
      }
    ],
    "upcomingLeaves": [
      {
        "id": "99f8d5cf-61e8-4669-95e2-2252a17be1f0",
        "kind": "leave",
        "leaveTypeName": "Casual Leave",
        "startDate": "2026-11-20",
        "endDate": "2026-11-21",
        "portion": "full"
      }
    ],
    "pendingRequests": {
      "count": 0,
      "items": []
    },
    "upcomingHolidays": [
      {
        "id": "e4f8d5cf-11e8-4669-95e2-2252a17be1f0",
        "name": "Christmas",
        "date": "2026-12-25"
      }
    ]
  }
  ```

### 2. `GET /dashboard/team` (`@MinRole(Role.manager)`)
Manager's team dashboard:
- `today`: Real-time day-type counts (`onLeave`, `wfh`, `available`, `off`, `total`).
- `upcoming`: Direct reports' approved leave/WFH in the next 7 days (`member`, `kind`, `startDate`, `endDate`, `portion`). Leaves that fall strictly on non-working/off dates are filtered out so managers only see actionable upcoming absences.
- Privacy: No leave type name, no reason.
- **Response (`200 OK`)**:
  ```json
  {
    "today": {
      "onLeave": 1,
      "wfh": 0,
      "available": 2,
      "off": 1,
      "total": 4
    },
    "upcoming": [
      {
        "member": {
          "id": "e3048995-c9bf-470a-8bf8-202d088921df",
          "name": "Alice Developer",
          "department": "Engineering"
        },
        "kind": "leave",
        "startDate": "2026-11-18",
        "endDate": "2026-11-19",
        "portion": "full"
      }
    ]
  }
  ```

### 3. `GET /dashboard/hr` (`@MinRole(Role.hr_admin)`)
HR department operational overview:
- `pendingApprovalsCount`: Number of pending requests this caller can decide (`canDecide`: HR Admin only counts staff and manager requests).
- `onLeaveToday`: Unique employees on leave and WFH today across the org (`{ leave, wfh }`).
- `headcount`: Active employees (`staff` + `manager` + `hr_admin`).
- `thisMonth`: Total approved leave days this calendar month `byLeaveType` and `byDepartment`.
- `requestsLast30Days`: Counts by status (`pending`, `approved`, `rejected`, `cancelled`).
- `upcomingHolidays`: Next 3 holidays.
- **Response (`200 OK`)**:
  ```json
  {
    "pendingApprovalsCount": 3,
    "onLeaveToday": {
      "leave": 2,
      "wfh": 1
    },
    "headcount": 25,
    "thisMonth": {
      "byLeaveType": [
        { "name": "Casual Leave", "days": 14.5 },
        { "name": "Work From Home", "days": 8 }
      ],
      "byDepartment": [
        { "department": "Engineering", "days": 18.5 },
        { "department": "Marketing", "days": 4 }
      ]
    },
    "requestsLast30Days": {
      "pending": 3,
      "approved": 15,
      "rejected": 2,
      "cancelled": 1
    },
    "upcomingHolidays": [
      { "id": "...", "name": "Christmas", "date": "2026-12-25" }
    ]
  }
  ```

### 4. `GET /dashboard/owner` (`@MinRole(Role.org_owner)`)
Executive view for Organization Owner:
- All metrics from `/dashboard/hr`, plus:
- `pendingHrAdminApprovals`: Count of pending requests submitted by HR Admins (decidable only by Org Owner).
- `activeHrAdmins`: Total count of active HR Admins in the organization.
- `recentAudit`: Last 10 audit log entries (`action`, `actorName`, `targetName`, `createdAt`).
- **Response (`200 OK`)**:
  ```json
  {
    "pendingApprovalsCount": 4,
    "onLeaveToday": { "leave": 2, "wfh": 1 },
    "headcount": 25,
    "thisMonth": { "byLeaveType": [], "byDepartment": [] },
    "requestsLast30Days": { "pending": 4, "approved": 15, "rejected": 2, "cancelled": 1 },
    "upcomingHolidays": [],
    "pendingHrAdminApprovals": 1,
    "activeHrAdmins": 2,
    "recentAudit": [
      {
        "id": "52ba41b0-13f5-47e1-88c9-7e5f1f9a29bc",
        "action": "HR_ADMIN_CREATED",
        "actorName": "Alice Owner",
        "targetName": "Bob HR",
        "createdAt": "2026-11-19T09:30:00.000Z"
      }
    ]
  }
  ```

---

## 🧪 Automated Test Suites

### Unit Tests (`LeaveYearService`, `ScheduleResolverService`, `LeaveRequestsService`, `ClockService`, & `EnvValidation`)
```bash
npm test
```
**Test Results (52/52 Passed across 5 suites)**:
- `test/env-validation.spec.ts` (5 tests passed):
  - Missing `DATABASE_URL` rejection
  - Minimum 32-character requirement for JWT secrets
  - Rejection of identical `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`
  - Default value application and validation
- `test/schedule-resolver.spec.ts` (23 tests passed):
  - Sunday rule (weight 0, weekly off)
  - Org fallback to `workingDays`
  - Assigned template Saturday modes (`off`, `half`, `full`)
  - Alternate Saturday rules (`[1, 3]` and `[2, 4]`) across months
  - Schedule transitions over time (effectiveFrom)
  - Span resolution (`resolveRange`)
  - Batch date span resolution (`resolveRangeForUsers`) with single-query efficiency
- `test/leave-year.spec.ts` (12 tests passed)
- `test/leave-counting.spec.ts` (9 tests passed)
- `test/clock.spec.ts` (3 tests passed)

### End-to-End Test Suites
```bash
npm run test:e2e
```
**Test Results (131/131 Passed across 9 suites)**:
- `test/full-lifecycle.e2e-spec.ts` (1 test passed):
  - **Full 21-step enterprise story**: Root platform login → Org + owner atomic creation → Owner first-time login and mandatory password change → Organization settings update → HR administrator creation & login → Leave types, schedule templates, and holidays creation → Manager and staff creation with manager assignment & schedule attachment → Annual balance allocation → Staff multi-segment leave + WFH request submission → Overlap validation conflict check (409 OVERLAP) → HR pending approvals inbox inspection & approval → Balance commitment from pending to used → Staff personal dashboard reflection → Manager privacy-redacted team availability view & peer my-team view → Saturday availability evaluation (`off`, `available`, `halfDay`) → HR approved leave cancellation & balance refund → HR backdated on-behalf leave submission with auto-approval → HR self-leave submission, blocked self-approval, and Owner approval → Annual carry-forward preview and execution → Tenant ownership transfer to HR administrator with immediate old-token revocation → Platform root organization suspension and universal session termination.
- `test/team-schedule-availability.e2e-spec.ts` (13 tests passed):
  - Saturday resolution across 6 schedule variants (A: Sat off, B: Sat half, C: Sat full, D: alternate [1,3], E: alternate [2,4], F: fallback [1..5])
  - Evaluation across all November 2026 Saturdays (Nov 7, 14, 21, 28)
  - Universal Sunday off rule across all employees regardless of template
  - Weekday organization holiday (`dayInfo.isHoliday: true`, `holidayName`, all members off)
  - Approved leave on off day shows status as `"off"` (not counted in leave); working Saturday shows `"leave"` or `"wfh"`
  - Single counting invariant (`total = onLeave + wfh + available + off`)
  - 14-day range with `holidays` at top-level and member `offDates` and `halfDates`
  - Date range validation (>92 days rejected with 400 Bad Request)
  - Batch schedule resolution query efficiency spy (exactly 1 `employeeSchedule` query for 50 members)
  - Strict privacy deep-scan (zero leak of templates, rules, reasons, or balances)
  - `/my-team/availability` and `/dashboard/team` day-type alignment
- `test/views-reports-dashboards.e2e-spec.ts` (17 tests passed):
  - `OrgScopeGuard` enforcement: root access to `/platform/*`, `/auth/*`, `/health` allowed; org routes blocked with 403 (`"Root org ke andar kaam nahi karta"`); non-root blocked from `/platform/*` (403)
  - Deep privacy & allowed keys scan on `/team` and `/my-team`: strictly no leakage of reason, leaveTypeId, leave type name, balance, or requestId
  - `GET /team/availability` & `today`: direct reports only, deactivated excluded, unapproved excluded, clipped ranges, half-day portion, single-counting
  - `GET /my-team/availability` & `today`: peers + manager for staff (including manager approved leaves), direct reports for manager, empty for unassigned staff, 92 days max range (400)
  - `GET /reports/calendar`: org-wide, department filter, `includePending=true`, pagination, sort by start date
  - `GET /reports/on-leave`: employees on leave / WFH for specific date
  - `GET /reports/balance-summary`: employee x leave type balances with department and leave type subtotals, row limit check
  - `GET /reports/utilization`: sum of countedWeight by department (with headcount and average), leaveType, and user; 0.5 half-day accuracy
  - CSV Export: UTF-8 BOM, header row, escaping, and formula injection prevention (`'`, `=`, `+`, `-`, `@`)
  - Dashboards: `/dashboard/me`, `/dashboard/team`, `/dashboard/hr` (caller-scoped pendingApprovalsCount), `/dashboard/owner` (pendingHrAdminApprovals, activeHrAdmins, recentAudit)
  - Tenant isolation: Org A data completely isolated from Org B across all read views
- `test/platform-org.e2e-spec.ts` (12 tests passed):
  - **Database raw SQL constraints verification**: Active presence of `uq_one_active_owner_per_org`, `uq_single_root`, and `chk_user_root_org` verified directly in PostgreSQL system catalogs (`pg_indexes`, `pg_constraint`)
  - Platform organization creation rollback on duplicate email
  - Tenant suspension and token revocation
  - Owner replacement and password reset
- `test/approvals.e2e-spec.ts` (22 tests passed)
- `test/leave-requests.e2e-spec.ts` (26 tests passed)
- `test/balances.e2e-spec.ts` (12 tests passed)
- `test/hr-setup.e2e-spec.ts` (16 tests passed)
- `test/auth.e2e-spec.ts` (12 tests passed)

**Total Automated Tests: 183 / 183 Passing**

---

## 🚀 Production Deployment Guide

The application is containerized and cloud-agnostic, capable of deploying to **Render**, **Railway**, **Fly.io**, **AWS ECS / App Runner**, or **Kubernetes**.

### 1. Database Migrations Rule (Release Step)
> [!IMPORTANT]
> **Never run database migrations automatically inside the container startup script (`CMD`).**
> In multi-replica or auto-scaling deployments, concurrent containers attempting migration will conflict and deadlock.
> Run migrations as a dedicated pre-deploy / release phase command:
> ```bash
> npx prisma migrate deploy
> ```

### 2. Multi-Stage Docker Build
```bash
# Build production Docker image
docker build -t lms-backend:latest .

# Run container locally with production env
docker run -d \
  -p 3000:3000 \
  --name lms-app \
  --env-file .env \
  lms-backend:latest
```

### 3. Deploying to PaaS (Render / Railway / Fly.io)
1. **Set Environment Variables**: Configure all required variables from the [Environment Variables Table](#️-environment-variables-reference-table).
2. **Pre-Deploy / Release Command**:
   ```bash
   npx prisma migrate deploy
   ```
3. **Application Start Command**:
   ```bash
   npm run start:prod
   ```
4. **Health Check Endpoints**:
   - Liveness probe: `/health`
   - Readiness probe: `/health/ready`

---

## 📘 Operations & Incident Runbook

### Runbook 1: Initial Platform Root Super-Administrator Seeding
Before any tenant organizations can be created, the platform requires an initial root administrator:
```bash
# Set credentials in environment
export ROOT_EMAIL="root@yourdomain.com"
export ROOT_PASSWORD="SuperSecretRootPassword123!"

# Run idempotent seed using DIRECT_URL connection
npm run prisma:seed
```
- The root user is created with `role: root` and `orgId: null` (enforced by `chk_user_root_org`).
- Upon first login at `POST /auth/login`, change the password via `POST /auth/change-password`.

### Runbook 2: Bootstrapping the First Tenant Organization
1. Log in as Root Super-Admin:
   ```bash
   curl -X POST https://api.yourdomain.com/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"root@yourdomain.com","password":"YourRootPassword123!"}'
   ```
   Copy the returned `accessToken`.
2. Create the Organization and initial Owner:
   ```bash
   curl -X POST https://api.yourdomain.com/platform/organizations \
     -H "Authorization: Bearer <ROOT_ACCESS_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{
       "orgName": "Acme Corp",
       "ownerName": "Alice Smith",
       "ownerEmail": "alice@acme.com",
       "tempPassword": "InitialTempPassword123!"
     }'
   ```
3. The owner logs in with `tempPassword` and is immediately required to set a permanent password before accessing `/org/*` routes.

### Runbook 3: Emergency JWT Secret Rotation
If `JWT_ACCESS_SECRET` or `JWT_REFRESH_SECRET` is leaked or compromised:
1. **Prepare New Secrets**: Generate two distinct 64-character random strings:
   ```bash
   openssl rand -hex 32
   ```
2. **Update Hosting Environment**: Update `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` in your hosting dashboard (Render / Railway / AWS).
3. **Redeploy Application**: Trigger a deployment.
4. **Invalidate Active DB Refresh Tokens**:
   Connect via psql using `DIRECT_URL` and revoke all active refresh tokens to force all users to re-authenticate:
   ```sql
   DELETE FROM "RefreshToken";
   ```
5. All previously issued access tokens and refresh cookies are immediately invalidated.

### Runbook 4: Resetting Organization Owner Password via Root
If a tenant organization owner is locked out or forgets their credentials:
1. As Root Super-Admin, invoke:
   ```bash
   curl -X POST https://api.yourdomain.com/platform/organizations/<ORG_ID>/reset-owner-password \
     -H "Authorization: Bearer <ROOT_ACCESS_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"tempPassword":"NewOwnerTempPassword123!"}'
   ```
2. This resets the owner's password, flags `mustChangePassword: true`, and automatically deletes all stored refresh tokens for that owner.

### Runbook 5: Neon Branching, Backup, and Point-in-Time Restore (PITR)
- **Instant Branching for Safe Testing / Staging**:
  In the Neon Console or via Neon CLI:
  ```bash
  neon branches create --name test-staging-branch --parent main
  ```
  Run the automated E2E test suite against this isolated branch without risking production data:
  ```bash
  export TEST_DATABASE_URL="<NEON_BRANCH_POOLED_URL>"
  export DIRECT_URL="<NEON_BRANCH_DIRECT_URL>"
  npm run test:neon
  ```
- **Point-in-Time Recovery (PITR)**:
  Neon maintains continuous WAL backups allowing you to restore your database to any second within your retention window. If data corruption occurs:
  1. Open Neon Console → **Branches** → **Restore**.
  2. Select the timestamp just prior to the incident (e.g. `2026-11-19 11:30:00 UTC`).
  3. Create a restored branch and update `DATABASE_URL` and `DIRECT_URL` in your hosting environment.

### Runbook 6: Known Limitations & Phase 2 Roadmap
- **No Bulk CSV Employee Import**: Employee creation is currently performed via `POST /users` (single record). Bulk CSV onboarding is slated for Phase 2.
- **No Outgoing Notifications**: Status changes and pending approvals are currently surfaced via `/dashboard/me`, `/dashboard/hr`, and `/approvals/pending`. Email (SendGrid/SES) and Slack webhooks are scheduled for Phase 2.
- **No Partial-Day Sub-Segment Approval**: Leave requests are approved or rejected in their entirety. Splitting or partially approving individual segments is planned for Phase 2.
- **Break-Glass Emergency Elevation**: Root super-admin cannot act inside tenant organizations directly (`OrgScopeGuard` prevents cross-boundary pollution). Break-glass access requires owner password reset or temporary owner replacement.
