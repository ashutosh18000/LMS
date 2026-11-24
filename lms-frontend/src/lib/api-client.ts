// ==============================================================================
// In-Memory Token Store & Typed API Client with Single-Flight Refresh Mutex
// ==============================================================================

import type { ApiErrorResponse, LoginResponse } from '../types/api';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// In-Memory Access Token Storage (Strictly NOT stored in localStorage or sessionStorage)
let memoryAccessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;
let onUnauthorizedCallback: (() => void) | null = null;

export function setMemoryAccessToken(token: string | null): void {
  memoryAccessToken = token;
}

export function getMemoryAccessToken(): string | null {
  return memoryAccessToken;
}

export function setOnUnauthorized(callback: () => void): void {
  onUnauthorizedCallback = callback;
}

export class ApiError extends Error {
  statusCode: number;
  code: string;
  details?: any;
  retryAfterSeconds?: number;

  constructor(res: ApiErrorResponse, retryAfterSeconds?: number) {
    super(res.message || 'An unexpected error occurred');
    this.name = 'ApiError';
    this.statusCode = res.statusCode;
    this.code = res.code || 'UNKNOWN_ERROR';
    this.details = res.details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Attempts single-flight refresh via POST /auth/refresh using httpOnly cookie.
 */
export async function silentRefreshToken(): Promise<string | null> {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      });

      if (!res.ok) {
        setMemoryAccessToken(null);
        return null;
      }

      const data: LoginResponse = await res.json();
      setMemoryAccessToken(data.accessToken);
      return data.accessToken;
    } catch {
      setMemoryAccessToken(null);
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export interface RequestOptions extends RequestInit {
  skipAuth?: boolean;
  params?: Record<string, string | number | boolean | undefined | null>;
}

/**
 * Core typed API requester with automatic header injection and single-flight 401 retry.
 */
export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestOptions = {},
): Promise<T> {
  const { skipAuth = false, params, ...customConfig } = options;

  let url = `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  if (params) {
    const searchParams = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') {
        searchParams.append(k, String(v));
      }
    }
    const queryString = searchParams.toString();
    if (queryString) {
      url += (url.includes('?') ? '&' : '?') + queryString;
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(customConfig.headers as Record<string, string>),
  };

  if (!skipAuth && memoryAccessToken) {
    headers['Authorization'] = `Bearer ${memoryAccessToken}`;
  }

  const config: RequestInit = {
    ...customConfig,
    headers,
    credentials: 'include', // Ensures httpOnly refresh cookie is sent
  };

  let response: Response;
  try {
    response = await fetch(url, config);
  } catch (netErr: any) {
    throw new ApiError({
      statusCode: 0,
      code: 'NETWORK_ERROR',
      message: netErr?.message || 'Failed to connect to LMS backend server. Please verify backend is running.',
    });
  }

  // Handle 401 with Single-Flight Refresh and 1 Retry
  if (response.status === 401 && !skipAuth && !endpoint.includes('/auth/login') && !endpoint.includes('/auth/refresh')) {
    const newToken = await silentRefreshToken();
    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`;
      response = await fetch(url, { ...config, headers });
    } else {
      if (onUnauthorizedCallback) {
        onUnauthorizedCallback();
      }
    }
  }

  // If response is not OK, parse structured error
  if (!response.ok) {
    let retryAfterSeconds: number | undefined;
    const retryHeader = response.headers.get('retry-after');
    if (retryHeader) {
      const parsed = parseInt(retryHeader, 10);
      if (!isNaN(parsed)) retryAfterSeconds = parsed;
    }

    let errorData: ApiErrorResponse;
    try {
      errorData = await response.json();
    } catch {
      errorData = {
        statusCode: response.status,
        code: 'HTTP_' + response.status,
        message: response.statusText || 'Request failed',
      };
    }

    throw new ApiError(errorData, retryAfterSeconds);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return null as any;
  }

  // Handle CSV export or non-json if requested
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/csv') || contentType.includes('application/octet-stream')) {
    return (await response.blob()) as any;
  }

  return (await response.json()) as T;
}

// User-friendly error translator: prioritizes backend message, falls back to code mapping
export function getFriendlyErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.statusCode === 429) {
      const timeMsg = err.retryAfterSeconds
        ? ` Please try again in ${err.retryAfterSeconds} seconds.`
        : ' Please wait before trying again.';
      return `Too many attempts.${timeMsg}`;
    }

    // Backend message takes precedence because it contains detailed contextual information (dates, balances, next available date, etc.)
    const backendMessage = typeof err.message === 'string' ? err.message.trim() : '';

    // Check if message is a generic HTTP status string
    const isGenericHttpStatusMessage =
      !backendMessage ||
      backendMessage === 'Forbidden' ||
      backendMessage === 'Conflict' ||
      backendMessage === 'Bad Request' ||
      backendMessage === 'Internal Server Error' ||
      backendMessage === 'Unauthorized' ||
      backendMessage === 'Not Found';

    if (!isGenericHttpStatusMessage) {
      return backendMessage;
    }

    // Fallback mapping by error code when backend message is empty or generic
    switch (err.code) {
      case 'OVERLAP':
        return 'Selected dates overlap with an existing leave request.';
      case 'INTRA_REQUEST_OVERLAP':
        return 'Multiple segments in this request overlap on the same date.';
      case 'INSUFFICIENT_BALANCE':
        return 'You do not have enough leave balance for this request.';
      case 'NO_BALANCE':
        return 'No leave balance record found for the requested leave type and year.';
      case 'MONTHLY_LIMIT_EXCEEDED':
        return 'Monthly limit exceeded for this leave type.';
      case 'MIN_NOTICE':
        return 'This leave requires advance notice.';
      case 'BACKDATE_EXCEEDED':
      case 'BACKDATE_NOT_ALLOWED':
        return 'Backdated leave exceeds the allowed backdate limit.';
      case 'ZERO_COUNTED_DAYS':
        return 'Selected date range contains 0 working days (e.g., weekend or holiday).';
      case 'HALF_DAY_NOT_ALLOWED':
        return 'Half-day is not permitted for this leave type or multi-day range.';
      case 'DECISION_COMMENT_REQUIRED':
        return 'A comment is required for every rejected segment.';
      case 'MISSING_SEGMENT_DECISIONS':
        return 'All pending segments must have a decision before submitting.';
      case 'NOT_AUTHORIZED_TO_DECIDE':
        return 'You are not authorized to decide on this request.';
      case 'ONLY_PENDING_CAN_BE_DECIDED':
        return 'Only pending requests can be decided.';
      case 'NO_PENDING_SEGMENTS':
        return 'No pending segments found for this request.';
      case 'CONCURRENT_UPDATE':
        return 'This request was modified concurrently or is no longer pending.';
      case 'OWNER_CANNOT_APPLY_LEAVE':
        return 'Organization owners cannot apply for leave.';
      case 'CANNOT_APPLY_FOR_SELF':
        return 'Cannot apply on behalf of yourself.';
      case 'CANNOT_APPLY_FOR_HR':
        return 'Only Organization Owner can apply on-behalf for HR Admin.';
      case 'INVALID_ON_BEHALF_TARGET':
        return 'On-behalf leave can only be applied for staff, manager, or HR admin.';
      case 'NOT_AUTHORIZED_TO_CANCEL':
        return 'You are not authorized to cancel this approved leave.';
      case 'CANNOT_CANCEL_REQUEST':
        return 'Only pending requests can be cancelled.';
      case 'ONLY_APPROVED_CAN_BE_CANCELLED':
        return 'Only approved or partially approved requests can be cancelled.';
      case 'INVALID_SEGMENT':
        return 'Invalid date segment provided.';
      case 'ORGANIZATION_SUSPENDED':
        return 'Your organization has been suspended. Please contact platform support.';
      case 'NETWORK_ERROR':
        return 'Unable to reach backend API. Please check your internet or local server.';
      default:
        if (err.statusCode === 403) {
          return 'You are not authorized to perform this action.';
        }
        if (err.statusCode === 409) {
          return 'This request has a conflict or was updated concurrently.';
        }
        return 'An error occurred while processing your request.';
    }
  }

  if (err instanceof Error) {
    return err.message;
  }

  return 'An unexpected error occurred.';
}
