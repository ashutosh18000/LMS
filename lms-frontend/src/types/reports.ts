export interface BalanceSummaryRow {
  userId: string;
  userName: string;
  department: string | null;
  leaveTypeId: string;
  leaveTypeName: string;
  year: number;
  allocated: number;
  used: number;
  pending: number;
  available: number;
}

export interface DepartmentBalanceTotal {
  department: string;
  allocated: number;
  used: number;
  pending: number;
  available: number;
}

export interface LeaveTypeBalanceTotal {
  leaveTypeId: string;
  leaveTypeName: string;
  allocated: number;
  used: number;
  pending: number;
  available: number;
}

export interface BalanceSummaryReportResponse {
  year: number;
  rows: BalanceSummaryRow[];
  totals: {
    byDepartment: DepartmentBalanceTotal[];
    byLeaveType: LeaveTypeBalanceTotal[];
  };
}

export interface UtilizationDepartmentItem {
  department: string;
  days: number;
  headcount: number;
  perEmployeeAverage: number;
}

export interface UtilizationLeaveTypeItem {
  leaveTypeId: string;
  leaveTypeName: string;
  isWfh: boolean;
  days: number;
}

export interface UtilizationUserItem {
  userId: string;
  userName: string;
  department: string | null;
  days: number;
}

export interface UtilizationReportResponse {
  from: string;
  to: string;
  groupBy: 'department' | 'leaveType' | 'user';
  items: Array<UtilizationDepartmentItem | UtilizationLeaveTypeItem | UtilizationUserItem>;
}
