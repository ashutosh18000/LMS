import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api-client';
import { safeArray } from '../../lib/safe-data';
import type { AuditLog } from '../../types/api';
import { formatCalendarDate } from '../../lib/utils';
import { Card, CardContent } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { HelpCircle, AlertCircle } from 'lucide-react';

export const AuditLogsPage: React.FC = () => {
  const { data: logsData, isLoading, error } = useQuery<any>({
    queryKey: ['org-audit-logs'],
    queryFn: () => apiRequest('/org/audit-logs?limit=50'),
  });
  const logs: AuditLog[] = safeArray(logsData, 'auditLogs');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Audit Trail</h1>
        <p className="text-xs text-slate-500 mt-1">
          Immutable system log of all administrative actions, approvals, adjustments, and policy updates
        </p>
      </div>

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Failed to load audit logs.</span>
        </div>
      )}

      {!isLoading && !error && logs.length === 0 && (
        <Card className="p-8 text-center text-slate-400">
          <p className="font-semibold text-slate-600 text-xs">No audit logs recorded yet.</p>
        </Card>
      )}

      {logs.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-semibold">
                <tr>
                  <th className="p-3">Timestamp</th>
                  <th className="p-3">Actor</th>
                  <th className="p-3">Action</th>
                  <th className="p-3">Target / Employee</th>
                  <th className="p-3">Reason / Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/50">
                    <td className="p-3 text-slate-500 whitespace-nowrap">
                      {formatCalendarDate(log.createdAt)} {new Date(log.createdAt).toLocaleTimeString()}
                    </td>
                    <td className="p-3 font-semibold text-slate-900 font-sans">
                      {log.actor?.name || 'System'}
                      <span className="text-[10px] text-slate-400 font-mono block">
                        ({log.actor?.role})
                      </span>
                    </td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded font-bold bg-slate-100 text-slate-800 border border-slate-200">
                        {log.action}
                      </span>
                    </td>
                    <td className="p-3 text-slate-700 font-sans">
                      {log.targetUser ? (
                        <div>
                          <span className="font-medium text-slate-800">{log.targetUser.name}</span>
                          <span className="text-[10px] text-slate-400 font-mono block">
                            ({log.targetUser.role})
                          </span>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="p-3 text-slate-600 font-sans max-w-xs truncate">
                      {log.reason || (log.metadata ? JSON.stringify(log.metadata) : '—')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
};
