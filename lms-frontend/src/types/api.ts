// ==============================================================================
// LMS Frontend TypeScript Types & API Definitions
// Corresponds directly with NestJS backend entities, DTOs, and OpenAPI paths.
// ==============================================================================

export type Role = 'root' | 'org_owner' | 'hr_admin' | 'manager' | 'staff';

export type OrgStatus = 'active' | 'suspended';

export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'partially_approved';

export type SegmentStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

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
  items: Array<{
    leaveTypeId: string;
    leaveTypeName: string;
    isWfh: boolean;
    deductsBalance: boolean;
    allocated: number | string | null;
    used: number | string | null;
    pending: number | string | null;
    available: number | string | null;
    monthlyLimit: number | string | null;
    usedThisMonth: number | string | null;
  }>;
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
  leaveTypeName?: string;
  isWfh?: boolean;
  startDate: string;
  endDate: string;
  portion: Portion;
  countedDays: number;
  status?: SegmentStatus;
  decidedAt?: string | null;
  decisionComment?: string | null;
  leaveType?: {
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
  name: string;
  department?: string | null;
  status: 'available' | 'leave' | 'wfh' | 'off';
  portion?: Portion | null;
  halfDay?: boolean;
}

export interface TodayAvailabilityResponse {
  date: string;
  dayInfo: {
    isHoliday: boolean;
    holidayName?: string;
  };
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
  status: 'available' | 'leave' | 'wfh' | 'off';
  portion?: Portion | null;
  halfDay?: boolean;
}

export interface RangeAvailabilityResponse {
  holidays: Array<{ date: string; name: string }>;
  members: Array<{
    userId: string;
    name: string;
    department: string | null;
    offDates: string[];
    halfDates: string[];
    segments: Array<{
      kind: 'leave' | 'wfh';
      startDate: string;
      endDate: string;
      portion: Portion;
    }>;
  }>;
}

// Dashboards
export interface DashboardMeResponse {
  balances: Array<{
    leaveTypeId: string;
    leaveTypeName: string;
    isWfh: boolean;
    year: number;
    allocated: number;
    used: number;
    pending: number;
    available: number;
    monthlyLimit: number | null;
    usedThisMonth?: number;
  }>;
  pendingRequests: {
    count: number;
    items: Array<{
      id: string;
      reason: string;
      spanDays: number;
      countedDays: number;
      createdAt: string;
      segments: Array<{
        id: string;
        leaveTypeId: string;
        leaveTypeName: string;
        isWfh: boolean;
        startDate: string;
        endDate: string;
        portion: Portion;
        countedDays: number;
      }>;
    }>;
  };
  upcomingLeaves: Array<{
    id: string;
    kind: 'leave' | 'wfh';
    leaveTypeName: string;
    startDate: string;
    endDate: string;
    portion: Portion;
  }>;
  upcomingHolidays: Array<{
    id: string;
    name: string;
    date: string;
  }>;
}

export interface DashboardTeamResponse {
  today: TodayAvailabilityResponse;
  upcoming: Array<{
    member: {
      id: string;
      name: string;
    };
    kind: 'leave' | 'wfh';
    startDate: string;
    endDate: string;
    portion: Portion;
  }>;
}

export interface DashboardHrResponse {
  pendingApprovalsCount: number;
  onLeaveToday: {
    leave: number;
    wfh: number;
  };
  headcount: number;
  thisMonth: {
    byLeaveType: Array<{ name: string; days: number }>;
    byDepartment: Array<{ department: string; days: number }>;
  };
  requestsLast30Days: {
    pending: number;
    approved: number;
    rejected: number;
    cancelled: number;
  };
  upcomingHolidays: Array<{ id: string; name: string; date: string }>;
}

export interface DashboardOwnerResponse extends DashboardHrResponse {
  pendingHrAdminApprovals: number;
  activeHrAdmins: number;
  recentAudit: Array<{
    id: string;
    action: string;
    actorName: string | null;
    targetName: string | null;
    createdAt: string;
  }>;
}

export interface PendingApprovalItem {
  id: string;
  requester: {
    id: string;
    name: string;
    role: Role;
    department: string | null;
  };
  segments: Array<{
    id: string;
    leaveTypeId: string;
    leaveTypeName: string;
    isWfh: boolean;
    startDate: string;
    endDate: string;
    portion: Portion;
    countedDays: number;
    status?: SegmentStatus;
    decidedAt?: string | null;
    decisionComment?: string | null;
  }>;
  reason: string;
  spanDays: number;
  countedDays: number;
  createdAt: string;
  createdBy: string | null;
}

export interface PendingApprovalsResponse {
  items: PendingApprovalItem[];
  total: number;
  page: number;
  limit: number;
}

export interface SegmentDecisionItem {
  segmentId: string;
  action: 'approve' | 'reject';
  comment?: string;
}

export interface DecideRequestPayload {
  decisions: SegmentDecisionItem[];
}

export interface DecideResponse {
  message: string;
  id: string;
  status: RequestStatus;
  segments: Array<{
    id: string;
    status: SegmentStatus;
    comment?: string | null;
  }>;
}

export interface MyLeaveRequestItem {
  id: string;
  reason: string;
  status: RequestStatus;
  spanDays: number;
  countedDays: number;
  createdAt: string;
  decidedAt: string | null;
  decisionComment: string | null;
  decidedBy: string | null;
  segments: Array<{
    id: string;
    leaveTypeId: string;
    leaveTypeName: string;
    isWfh: boolean;
    startDate: string;
    endDate: string;
    portion: Portion;
    countedDays: number;
    status?: SegmentStatus;
    decidedAt?: string | null;
    decisionComment?: string | null;
  }>;
}

export interface MyLeaveRequestsResponse {
  items: MyLeaveRequestItem[];
  total: number;
  page: number;
  limit: number;
}

// In-App Notification Types
export type NotificationType = 'leave_decided' | 'leave_cancelled';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  requestId?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export interface PaginatedNotificationsResponse {
  items: NotificationItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface UnreadCountResponse {
  unreadCount: number;
  count: number;
}

export interface MarkReadResponse {
  message: string;
  id: string;
  readAt: string;
}

export interface MarkAllReadResponse {
  message: string;
  count: number;
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
