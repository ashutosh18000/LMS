# Multi-tenant Leave Management System Backend

Multi-tenant Leave Management System backend built with **NestJS**, **PostgreSQL (Neon)**, and **Prisma ORM**.

---

## 🛠 Tech Stack & Rules

- **Framework**: NestJS (TypeScript)
- **Database**: PostgreSQL hosted on [Neon](https://neon.tech)
- **ORM**: Prisma (Latest stable v6)
- **Validation**: Strict DTO validation via `class-validator` & `class-transformer`
- **Global ValidationPipe**: `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`
- **Security & Utilities**: `bcrypt` (10 salt rounds), `cookie-parser`, `@nestjs/config`, `@nestjs/throttler`, `@nestjs/jwt`, `@nestjs/passport`
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

## 🧪 Automated Test Suites

### Unit Tests (`LeaveYearService`, `ScheduleResolverService`, `LeaveRequestsService`, & `ClockService`)
```bash
npm test
```
**Test Results (45/45 Passed across 4 suites)**:
- `test/schedule-resolver.spec.ts` (21 tests passed)
- `test/leave-year.spec.ts` (12 tests passed)
- `test/leave-counting.spec.ts` (10 tests passed)
- `test/clock.spec.ts` (2 tests passed)

### End-to-End Test Suites
```bash
npm run test:e2e
```
**Test Results (99/99 Passed across 6 suites)**:
- `test/approvals.e2e-spec.ts` (22 tests passed):
  - `POST /approvals/:id/approve` commits balance (`pending -> used`) and audits `LEAVE_APPROVED`
  - Blocks subsequent approve or reject with HTTP 409
  - `POST /approvals/:id/reject` requires comment, releases balance, marks final, and audits `LEAVE_REJECTED`
  - `canDecide` permission enforcement: self-decision blocked (403), HR cannot decide other HR (403/404), Org Owner can approve HR, staff/manager blocked (403)
  - `GET /approvals/pending` inbox with oldest-first sort, caller authority filtering, and `onlyHrAdmins` filter
  - Tenant isolation: Org B HR cannot see Org A pending requests
  - `GET /approvals/:id` returns balances, monthlyUsage, and teamConflicts accurately
  - Concurrency & Race Conditions (Promise.all): approve vs cancel, double approve, approve vs reject
  - `POST /leave-requests/on-behalf` bypasses backdate & notice, auto-commits balance, or creates pending request
  - Self-apply on-behalf forbidden (403); HR applying for another HR forbidden (403)
  - `POST /leave-requests/:id/cancel-approved` refunds used balance, preserves decision comment, and frees dates
  - Cancelling pending or rejected via `cancel-approved` blocked with 409; caller cancelling own approved leave blocked (403)
  - `GET /leave-requests` org-wide history with filters and pagination
  - User Deactivation Hook: auto-cancels pending requests, releases balances, preserves approved leaves, logs `LEAVE_AUTO_CANCELLED`
- `test/leave-requests.e2e-spec.ts` (26 tests passed)
- `test/balances.e2e-spec.ts` (12 tests passed)
- `test/hr-setup.e2e-spec.ts` (16 tests passed)
- `test/platform-org.e2e-spec.ts` (11 tests passed)
- `test/auth.e2e-spec.ts` (12 tests passed)
