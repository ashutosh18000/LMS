import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format YYYY-MM-DD calendar date string safely without timezone shift.
 * Never use new Date("2026-11-02") directly because in UTC- or non-UTC zones it shifts.
 */
export function formatCalendarDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  // If ISO with time, split at 'T'
  const clean = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
  const [year, month, day] = clean.split('-');
  if (!year || !month || !day) return dateStr;

  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const mIndex = parseInt(month, 10) - 1;
  const monthName = monthNames[mIndex] || month;
  return `${day} ${monthName} ${year}`;
}

export function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function roleBadgeColor(role?: string): string {
  switch (role) {
    case 'root':
      return 'bg-purple-100 text-purple-800 border-purple-200';
    case 'org_owner':
      return 'bg-amber-100 text-amber-800 border-amber-200';
    case 'hr_admin':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'manager':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    case 'staff':
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

export function statusBadgeColor(status?: string): string {
  switch (status) {
    case 'approved':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'partially_approved':
      return 'bg-purple-50 text-purple-700 border-purple-200';
    case 'pending':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'rejected':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    case 'cancelled':
      return 'bg-slate-100 text-slate-600 border-slate-200';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

export function formatStatusLabel(status?: string): string {
  switch (status) {
    case 'partially_approved':
      return 'Partially Approved';
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Rejected';
    case 'cancelled':
      return 'Cancelled';
    case 'pending':
      return 'Pending';
    default:
      return status ? status.replace('_', ' ') : '—';
  }
}
