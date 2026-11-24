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

// User-friendly error translator based on backend error codes
export function getFriendlyErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.statusCode === 429) {
      const timeMsg = err.retryAfterSeconds ? ` Please try again in ${err.retryAfterSeconds} seconds.` : ' Please wait before trying again.';
      return `Too many attempts.${timeMsg}`;
    }

    if (err.statusCode === 403) {
      return err.message && !err.message.includes('Forbidden') && !err.message.includes('nahi')
        ? err.message
        : 'You are not authorized to perform or decide on this request.';
    }

    if (err.statusCode === 409) {
      return err.message && !err.message.includes('Conflict') && !err.message.includes('nahi')
        ? err.message
        : 'This request was modified concurrently or is no longer in pending status.';
    }

    if (err.statusCode === 400 && err.message) {
      if (err.message.includes('comment') || err.message.includes('zaroori')) {
        return 'A comment is required for every rejected segment.';
      }
      if (err.message.includes('Missing segment') || err.message.includes('decision dena')) {
        return 'All pending segments must have a decision before submitting.';
      }
    }

    switch (err.code) {
      case 'OVERLAP':
        return err.message || 'Selected dates overlap with an existing leave request.';
      case 'INSUFFICIENT_BALANCE':
        return err.message || 'You do not have enough leave balance for this request.';
      case 'NO_BALANCE':
        return 'No leave balance record found for the requested leave type and year.';
      case 'MONTHLY_LIMIT_EXCEEDED':
        return err.message || 'Monthly limit exceeded for this leave type.';
      case 'MIN_NOTICE':
        return err.message || 'This leave requires advance notice.';
      case 'BACKDATE_EXCEEDED':
        return err.message || 'Backdated leave exceeds the allowed backdate limit.';
      case 'ZERO_COUNTED_DAYS':
        return 'Selected date range contains 0 working days (e.g., weekend or holiday).';
      case 'HALF_DAY_NOT_ALLOWED':
        return 'Half-day is not permitted for this leave type or multi-day range.';
      case 'INVALID_SEGMENT':
        return err.message || 'Invalid date segment provided.';
      case 'ORGANIZATION_SUSPENDED':
        return 'Your organization has been suspended. Please contact platform support.';
      case 'NETWORK_ERROR':
        return 'Unable to reach backend API. Please check your internet or local server.';
      default:
        return err.message || 'An error occurred while processing your request.';
    }
  }

  if (err instanceof Error) {
    return err.message;
  }

  return 'An unexpected error occurred.';
}
