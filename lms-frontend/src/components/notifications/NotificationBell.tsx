import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiRequest, getFriendlyErrorMessage } from '../../lib/api-client';
import { safeArray } from '../../lib/safe-data';
import { useAuth } from '../../context/AuthContext';
import type {
  PaginatedNotificationsResponse,
  UnreadCountResponse,
  MarkReadResponse,
  MarkAllReadResponse,
  NotificationItem,
} from '../../types/api';
import { formatCalendarDate } from '../../lib/utils';
import {
  Bell,
  CheckCheck,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
  AlertCircle,
} from 'lucide-react';

export const NotificationBell: React.FC = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // 1. Unread count query (Refreshed every 60s and on window focus)
  const { data: unreadData } = useQuery<UnreadCountResponse>({
    queryKey: ['notifications-unread-count'],
    queryFn: () => apiRequest<UnreadCountResponse>('/notifications/unread-count'),
    refetchInterval: 60000, // 60 seconds
    refetchOnWindowFocus: true, // on page/window focus
    enabled: !!user,
  });
  const unreadCount = unreadData?.unreadCount ?? 0;

  // 2. Notifications list query
  const {
    data: notifData,
    isLoading: isNotifsLoading,
    error: notifError,
  } = useQuery<PaginatedNotificationsResponse>({
    queryKey: ['notifications'],
    queryFn: () =>
      apiRequest<PaginatedNotificationsResponse>('/notifications', {
        params: { limit: 25 },
      }),
    enabled: isOpen && !!user,
  });
  const notifications = safeArray(notifData?.items, 'notifications');

  // 3. Mark single notification as read
  const markReadMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest<MarkReadResponse>(`/notifications/${id}/read`, {
        method: 'PATCH',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  // 4. Mark all notifications as read
  const markAllReadMutation = useMutation({
    mutationFn: () =>
      apiRequest<MarkAllReadResponse>('/notifications/read-all', {
        method: 'POST',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const handleNotificationClick = (n: NotificationItem) => {
    if (!n.readAt) {
      markReadMutation.mutate(n.id);
    }
    setIsOpen(false);

    // Route to appropriate screen based on user role and notification context
    if (n.requestId) {
      if (user?.role === 'manager') {
        navigate('/team/availability');
      } else if (user?.role === 'hr_admin' || user?.role === 'org_owner') {
        navigate('/hr/approvals');
      } else {
        navigate('/my-requests');
      }
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="relative p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100/80 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
        title="View Notifications"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-rose-600 rounded-full shadow-sm animate-in zoom-in-50">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Popover */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-2xl shadow-xl border border-slate-200/80 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
          {/* Header */}
          <div className="px-4 py-3 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-slate-900">Notifications</span>
              {unreadCount > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">
                  {unreadCount} new
                </span>
              )}
            </div>

            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => markAllReadMutation.mutate()}
                disabled={markAllReadMutation.isPending}
                className="text-xs text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1 hover:underline disabled:opacity-50"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Mark all as read
              </button>
            )}
          </div>

          {/* Notifications List */}
          <div className="max-h-96 overflow-y-auto divide-y divide-slate-100 text-xs">
            {isNotifsLoading && (
              <div className="p-4 space-y-3">
                <div className="h-12 bg-slate-100 rounded-xl animate-pulse" />
                <div className="h-12 bg-slate-100 rounded-xl animate-pulse" />
                <div className="h-12 bg-slate-100 rounded-xl animate-pulse" />
              </div>
            )}

            {notifError && (
              <div className="p-4 text-center text-rose-600 text-xs flex items-center justify-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Failed to load notifications.</span>
              </div>
            )}

            {!isNotifsLoading && notifications.length === 0 && (
              <div className="p-8 text-center text-slate-400">
                <Bell className="w-8 h-8 mx-auto mb-2 opacity-40 text-slate-400" />
                <p className="font-semibold text-slate-600 text-xs">No notifications yet</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  You'll see alerts here when your leave requests are decided or cancelled.
                </p>
              </div>
            )}

            {!isNotifsLoading &&
              notifications.map((n) => {
                const isUnread = !n.readAt;

                return (
                  <div
                    key={n.id}
                    onClick={() => handleNotificationClick(n)}
                    className={`p-3.5 cursor-pointer transition-colors flex items-start gap-3 hover:bg-slate-50 ${
                      isUnread ? 'bg-blue-50/40' : 'bg-white'
                    }`}
                  >
                    {/* Icon */}
                    <div className="mt-0.5 shrink-0">
                      {n.type === 'leave_decided' ? (
                        <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
                          <CheckCircle2 className="w-4 h-4" />
                        </div>
                      ) : (
                        <div className="w-7 h-7 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
                          <Clock className="w-4 h-4" />
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center justify-between gap-1">
                        <span
                          className={`font-semibold text-xs truncate ${
                            isUnread ? 'text-slate-900 font-bold' : 'text-slate-700'
                          }`}
                        >
                          {n.title}
                        </span>
                        {isUnread && (
                          <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0" />
                        )}
                      </div>

                      <p className="text-[11px] text-slate-600 whitespace-pre-line leading-relaxed">
                        {n.body}
                      </p>

                      <div className="flex items-center justify-between pt-0.5 text-[10px] text-slate-400">
                        <span>{formatCalendarDate(n.createdAt)}</span>
                        {n.requestId && (
                          <span className="text-blue-600 font-medium flex items-center gap-0.5 hover:underline">
                            View request <ExternalLink className="w-2.5 h-2.5" />
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
};
