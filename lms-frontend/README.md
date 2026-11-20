# LMS Frontend - React + Vite Demo Portal

A modern, responsive, and role-based frontend for the **NestJS + Prisma + PostgreSQL (Neon)** Leave Management System (LMS).

This frontend was built specifically as an interactive **DEMO portal** to showcase the full enterprise lifecycle of the multi-tenant leave management platform across all five user roles.

---

## 🚀 Tech Stack

- **Framework**: React 19 + Vite 6/8 + TypeScript
- **Styling**: Tailwind CSS v3 with accessible design tokens
- **Routing**: React Router DOM (v7) with role-based route guards
- **State & Server Cache**: TanStack Query (React Query v5) with 30s cache TTL
- **Form Handling**: React Hook Form + Zod
- **Date Handling**: Plain ISO/calendar string operations + `date-fns` (strict timezone shift protection)
- **Icons**: Lucide React
- **API Client**: In-memory token store with single-flight silent refresh mutex and structured error handler

---

## 🔐 Auth & Security Architecture

- **In-Memory Access Token**: Access tokens are stored **strictly in memory** (never in `localStorage` or `sessionStorage`).
- **HttpOnly Refresh Cookie**: Refresh tokens are stored in secure `httpOnly` cookies with `path=/auth`.
- **Silent Refresh on Page Load**: Automatically performs silent login on load or reload via `POST /auth/refresh`.
- **Single-Flight 401 Interceptor**: If an API call receives a `401 Unauthorized`, a single refresh promise is dispatched (deduplicating concurrent requests), and the failed request is retried seamlessly.
- **Forced Password Change**: If `mustChangePassword === true`, the user is locked to `/change-password` until a new compliant password is saved.

---

## 🛠️ Local Setup & Running the Frontend

### 1. Environment Configuration

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Default configuration:
```env
VITE_API_URL=http://localhost:3000
VITE_DEMO_MODE=true
```

### 2. Backend Configuration for Local Demo

In the backend root `.env` file, ensure CORS and Cookie settings permit local Vite development:

```env
# Allow Vite frontend origin
CORS_ORIGINS="http://localhost:5173"

# Allow cross-port cookie sharing on localhost
COOKIE_SAMESITE="lax"
```

> **Note:** The backend has built-in defaults: in development/test mode, if `CORS_ORIGINS` is unset, it automatically reflects the caller origin with `credentials: true`. Setting `COOKIE_SAMESITE=lax` ensures the refresh cookie can be read by `fetch` calls across `localhost:5173` &bull; `localhost:3000`.

### 3. Install & Start Development Server

```bash
cd lms-frontend
npm install
npm run dev
```

The portal will be accessible at: **`http://localhost:5173`**

---

## 📦 Demo Database Seeding (`seed:demo`)

> ⚠️ **IMPORTANT SAFETY NOTICE**: Run `seed:demo` **ONLY on a dedicated Neon demo/dev branch**, **NEVER on production or test branch**!

To populate demo organizations, leave types, employees, and balances:

```bash
# In the root backend directory:
npm run seed:demo
```

### Demo Preset Logins (`password: DemoPassword123!`):

| Role | Email | Capabilities |
| :--- | :--- | :--- |
| **Org Owner** | `owner@acme.com` | Org settings, FY cycle, transfer ownership, HR approvals |
| **HR Admin** | `hr@acme.com` | Approvals inbox, on-behalf apply, employee directory, leave types, schedules, carry-forward, reports |
| **Manager** | `manager1@acme.com` | Team dashboard, team availability calendar, own leave apply |
| **Staff** | `staff1@acme.com` | Personal dashboard, apply leave/WFH, my requests, holidays, team peer availability |
| **Platform Root** | `root@example.com` | Tenant organization provisioning and suspension |

*(When `VITE_DEMO_MODE=true`, quick-fill buttons are displayed directly on the login screen for 1-click access).*

---

## 🎬 End-to-End Demo Walkthrough Guide

Follow this sequence to experience the full LMS platform in action:

1. **Step 1: Staff Applies for Multi-Segment Leave**
   - Click **Staff** quick-fill button (`staff1@acme.com`).
   - Navigate to **Apply Leave / WFH**.
   - Fill in reason and add 2 segments:
     - Segment 1: Casual Leave (2 days)
     - Segment 2: Work From Home (1 day)
   - Click **Preview Days & Breakdown** &rarr; Notice calculation breakdown and counted days.
   - Click **Submit Request**.
   - Check **My Requests** &rarr; Status is `pending`.

2. **Step 2: HR Admin Approves the Request**
   - Sign out and click **HR Admin** quick-fill (`hr@acme.com`).
   - Navigate to **Approvals Inbox**.
   - Review the pending request submitted by `staff1@acme.com`.
   - Click **Approve** (or test **Reject** with reason).
   - Status updates in real-time and balance is committed.

3. **Step 3: Manager Views Team Availability Calendar**
   - Sign out and click **Manager** quick-fill (`manager1@acme.com`).
   - Navigate to **Team Availability**.
   - View the 14-day schedule matrix &rarr; See `staff1` tagged with `L` (Leave) and `WFH`.
   - **Privacy Rule Verified**: Notice that leave reason, balance, and policy names are **hidden** from team view.

4. **Step 4: HR Admin Applies On-Behalf**
   - Switch back to **HR Admin**.
   - Navigate to **Apply On-Behalf**.
   - Select an employee, check **Auto-approve**, enter on-behalf justification reason, and submit.
   - The leave is immediately approved, balance reserved/committed, and recorded in the audit trail.

5. **Step 5: Review Audit Trail & Org Settings**
   - Sign in as **Org Owner** (`owner@acme.com`).
   - Navigate to **Audit Trail** (`/org/audit-logs`) &rarr; View immutable records of on-behalf applications and approval decisions.
   - Navigate to **Organization Settings** &rarr; Adjust working days or backdate allowance.

---

## 📋 Comprehensive Screens Implementation Status

| Section | Screen | Route | Status |
| :--- | :--- | :--- | :--- |
| **Auth** | Login Screen (with Demo quick-fill) | `/login` | ✅ Complete |
| **Auth** | Change Password Enforced Screen | `/change-password` | ✅ Complete |
| **Staff** | My Dashboard (`GET /dashboard/me`) | `/dashboard` | ✅ Complete |
| **Staff** | My Balances (`GET /me/balances`) | `/balances` | ✅ Complete |
| **Staff** | Apply Multi-Segment Leave (`POST /leave-requests`) | `/apply-leave` | ✅ Complete |
| **Staff** | My Requests & Cancel (`GET /leave-requests/mine`) | `/my-requests` | ✅ Complete |
| **Staff** | Holidays Directory (`GET /holidays`) | `/holidays` | ✅ Complete |
| **Staff** | Peer Team Status Today (`GET /my-team/availability/today`) | `/my-team` | ✅ Complete |
| **Manager** | Manager Dashboard (`GET /dashboard/team`) | `/manager/dashboard` | ✅ Complete |
| **Manager** | Team Availability Matrix (`GET /team/availability`) | `/team/availability` | ✅ Complete |
| **HR** | HR Dashboard (`GET /dashboard/hr`) | `/hr/dashboard` | ✅ Complete |
| **HR** | Approvals Inbox (Self-approval protection) | `/hr/approvals` | ✅ Complete |
| **HR** | Apply On-Behalf (`POST /leave-requests/on-behalf`) | `/hr/on-behalf` | ✅ Complete |
| **HR** | Employees Management (`/users`) | `/hr/users` | ✅ Complete |
| **HR** | Leave Types & Quotas (`/leave-types`) | `/hr/leave-types` | ✅ Complete |
| **HR** | Work Schedules & Saturday Modes (`/schedule-templates`) | `/hr/schedules` | ✅ Complete |
| **HR** | Manage Holidays (`/holidays/manage`) | `/hr/holidays` | ✅ Complete |
| **HR** | Bulk Allocation & Balance Adjustment | `/hr/balances` | ✅ Complete |
| **HR** | Year-End Carry Forward Preview & Run | `/hr/carry-forward` | ✅ Complete |
| **HR** | Reports & CSV Export (`GET /reports/*`) | `/hr/reports` | ✅ Complete |
| **Owner** | Org Owner Dashboard (`GET /dashboard/owner`) | `/owner/dashboard` | ✅ Complete |
| **Owner** | Organization Settings (`PATCH /org/settings`) | `/org/settings` | ✅ Complete |
| **Owner** | Transfer Ownership (`POST /org/transfer-ownership`) | `/org/transfer-ownership` | ✅ Complete |
| **Owner** | Audit Trail Viewer (`GET /org/audit-logs`) | `/org/audit-logs` | ✅ Complete |
| **Root** | Platform Organizations & Suspension (`/platform/*`) | `/platform/organizations` | ✅ Complete |

---

## 🏗️ Production Build & Verification

```bash
cd lms-frontend
npm run build
```

The build compiles with 0 errors and generates optimized production artifacts in `dist/`.
