import { Role } from '@prisma/client';

export interface DecisionUser {
  id: string;
  role: Role;
  orgId?: string | null;
}

/**
 * Single permission rule for deciding on leave requests (approve, reject, cancel-approved, on-behalf hr_admin target).
 *
 * Rules:
 * 1. Caller and requester must NOT be the same person (cannot decide on own request -> false).
 * 2. Requester is hr_admin: only org_owner (or root) can decide.
 * 3. Requester is staff or manager: hr_admin or org_owner (or root) can decide.
 * 4. Manager and staff as callers cannot decide on anything.
 * 5. Caller and requester must belong to the same organization (unless root).
 */
export function canDecide(caller: DecisionUser, requester: DecisionUser): boolean {
  if (caller.id === requester.id) {
    return false;
  }

  if (caller.role !== Role.root && caller.orgId !== requester.orgId) {
    return false;
  }

  if (caller.role === Role.staff || caller.role === Role.manager) {
    return false;
  }

  if (requester.role === Role.hr_admin) {
    return caller.role === Role.org_owner || caller.role === Role.root;
  }

  if (requester.role === Role.staff || requester.role === Role.manager) {
    return (
      caller.role === Role.hr_admin ||
      caller.role === Role.org_owner ||
      caller.role === Role.root
    );
  }

  return false;
}
