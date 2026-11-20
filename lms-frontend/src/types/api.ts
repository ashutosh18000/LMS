// ==============================================================================
// LMS Frontend TypeScript Types & API Definitions
// Corresponds directly with NestJS backend entities, DTOs, and OpenAPI paths.
// ==============================================================================

export type Role = 'root' | 'org_owner' | 'hr_admin' | 'manager' | 'staff';

export type OrgStatus = 'active' | 'suspended';

export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export type Portion = 'full' | 'first_half' | 'second_half';

export type SaturdayMode = 'off' | 'half' | 'full' | 'alternate';

export type SkipReason = 'none' | 'weekly_off' | 'holiday';

// Standard Backend Global Error Format
export interface ApiErrorResponse {
  statusCode: number;
  code: string;
  message: string;
  details?: any;
}

// Auth Types
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  orgId: string | null;
  mustChangePassword: boolean;
  active: boolean;
  department?: string | null;
  organization?: {
    id: string;
    name: string;
    status: OrgStatus;
    timezone: string;
  } | null;
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

// User Entity
export interface User {
  id: string;
  orgId: string | null;
  name: string;
  email: string;
  role: Role;
  department?: string | null;
  managerId?: string | null;
  manager?: {
    id: string;
    name: string;
    email: string;
  } | null;
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedUsersResponse {
  items: User[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

// Organization Entity
export interface Organization {
  id: string;
  name: string;
  status: OrgStatus;
  timezone: string;
  financialYearStartMonth: number;
  workingDays: number[];
  backdateAllowedDays: number;
  createdAt: string;
  updatedAt: string;
  owner?: {
    id: string;
    name: string;
    email: string;
  };
  _count?: {
    users: number;
  };
}

// Leave Types
export interface LeaveType {
  id: string;
  orgId: string;
  name: string;
  paid: boolean;
  deductsBalance: boolean;
  daysPerYear: number | null;
  carryForwardMax: number;
  halfDayAllowed: boolean;
  minNoticeDays: number;
  isWfh: boolean;
  monthlyLimit?: number | null;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// Work Schedules & Templates
export interface WorkScheduleTemplate {
  id: string;
  orgId: string;
  name: string;
  saturdayMode: SaturdayMode;
  alternateOffWeeks: number[];
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface EmployeeSchedule {
  id: string;
  userId: string;
  templateId: string;
  effectiveFrom: string;
  template: WorkScheduleTemplate;
}

// Holidays
export interface Holiday {
  id: string;
  orgId: string;
  name: string;
  date: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// Balances
export interface BalanceAdjustment {
  id: string;
  delta: number;
  reason: string;
  createdAt: string;
  actor?: {
    id: string;
    name: string;
  };
}

export interface LeaveBalance {
  id: string;
  orgId: string;
  userId: string;
  leaveTypeId: string;
  year: number;
  allocated: number;
  used: number;
  pending: number;
  available: number;
  leaveType: LeaveType;
  adjustments?: BalanceAdjustment[];
}

export interface MyBalancesResponse {
  year: number;
  balances: LeaveBalance[];
}

// Leave Requests & Segments
export interface LeaveSegmentDay {
  id: string;
  segmentId: string;
  date: string;
  occupancy: number;
  countedWeight: number;
  skipReason: SkipReason;
}

export interface LeaveSegment {
  id: string;
  requestId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  portion: Portion;
  countedDays: number;
  leaveType: {
    id: string;
    name: string;
    isWfh: boolean;
  };
}

export interface LeaveRequest {
  id: string;
  orgId: string;
  userId: string;
  reason: string;
  status: RequestStatus;
  spanDays: number;
  countedDays: number;
  createdBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  user?: {
    id: string;
    name: string;
    role: Role;
    department: string | null;
  };
  creator?: {
    id: string;
    name: string;
    role: Role;
  };
  decider?: {
    id: string;
    name: string;
    role: Role;
  } | null;
  segments: LeaveSegment[];
  segmentDays?: LeaveSegmentDay[];
}

export interface LeaveRequestPreview {
  spanDays: number;
  countedDays: number;
  breakdown: Array<{
    date: string;
    leaveTypeId: string;
    portion: Portion;
    occupancy: number;
    countedWeight: number;
    skipReason: SkipReason;
  }>;
}

// Availability Types
export interface AvailabilityMemberSummary {
  userId: string;
  userName: string;
  department?: string | null;
  role: Role;
  status: 'available' | 'on_leave' | 'wfh' | 'off';
  portion?: Portion | null;
  offReason?: 'weekly_off' | 'holiday' | null;
  holidayName?: string | null;
}

export interface TodayAvailabilityResponse {
  date: string;
  counts: {
    total: number;
    available: number;
    onLeave: number;
    wfh: number;
    off: number;
  };
  members: AvailabilityMemberSummary[];
}

export interface DayAvailabilityGrid {
  date: string;
  status: 'available' | 'on_leave' | 'wfh' | 'off';
  portion?: Portion | null;
  offReason?: 'weekly_off' | 'holiday' | null;
  holidayName?: string | null;
}

export interface RangeAvailabilityResponse {
  from: string;
  to: string;
  members: Array<{
    userId: string;
    userName: string;
    department?: string | null;
    role: Role;
    days: Record<string, DayAvailabilityGrid>;
  }>;
}

// Dashboards
export interface DashboardMeResponse {
  user: {
    id: string;
    name: string;
    role: Role;
    department: string | null;
  };
  year: number;
  balances: Array<{
    leaveTypeId: string;
    name: string;
    isWfh: boolean;
    allocated: number;
    used: number;
    pending: number;
    available: number;
    monthlyLimit?: number | null;
    usedThisMonth?: number;
  }>;
  pendingRequests: LeaveRequest[];
  upcomingLeaves: LeaveRequest[];
}

export interface DashboardTeamResponse {
  teamSize: number;
  today: TodayAvailabilityResponse;
  pendingTeamRequestsCount: number;
}

export interface DashboardHrResponse {
  stats: {
    totalUsers: number;
    pendingApprovals: number;
    onLeaveToday: number;
    wfhToday: number;
  };
  todayAvailability: TodayAvailabilityResponse;
  recentPending: LeaveRequest[];
}

export interface DashboardOwnerResponse {
  org: {
    id: string;
    name: string;
    status: OrgStatus;
    timezone: string;
    financialYearStartMonth: number;
  };
  stats: {
    totalEmployees: number;
    totalHrAdmins: number;
    pendingApprovals: number;
    onLeaveToday: number;
  };
}

// Audit Logs
export interface AuditLog {
  id: string;
  orgId: string;
  actorId: string;
  targetUserId?: string | null;
  action: string;
  reason?: string | null;
  metadata?: any;
  createdAt: string;
  actor?: {
    id: string;
    name: string;
    role: Role;
  };
  targetUser?: {
    id: string;
    name: string;
    role: Role;
  } | null;
}
