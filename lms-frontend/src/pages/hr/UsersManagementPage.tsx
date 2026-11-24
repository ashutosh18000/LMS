import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, getFriendlyErrorMessage } from '../../lib/api-client';
import { safeArray } from '../../lib/safe-data';
import type { User, PaginatedUsersResponse, WorkScheduleTemplate, Role } from '../../types/api';
import { formatCalendarDate, roleBadgeColor } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { Modal } from '../../components/ui/modal';
import { Plus, Search, UserPlus, Calendar, KeyRound, AlertCircle, CheckCircle2, UserX, UserCheck } from 'lucide-react';

export const UsersManagementPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [page, setPage] = useState(1);

  // Modals state
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [scheduleTarget, setScheduleTarget] = useState<User | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().split('T')[0]);

  // Add User Form State
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'staff' | 'manager'>('staff');
  const [department, setDepartment] = useState('');
  const [managerId, setManagerId] = useState('');

  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; message: string } | null>(null);

  // Fetch paginated users
  const { data, isLoading, error } = useQuery<PaginatedUsersResponse>({
    queryKey: ['users-list', page, searchTerm, roleFilter],
    queryFn: () =>
      apiRequest<PaginatedUsersResponse>('/users', {
        params: { page, limit: 15, search: searchTerm || undefined, role: roleFilter || undefined },
      }),
  });

  // Fetch managers for assignment
  const { data: managersData } = useQuery<PaginatedUsersResponse>({
    queryKey: ['users-managers'],
    queryFn: () => apiRequest<PaginatedUsersResponse>('/users?role=manager&limit=50'),
  });

  // Fetch schedule templates
  const { data: templates = [] } = useQuery<WorkScheduleTemplate[]>({
    queryKey: ['schedule-templates-active'],
    queryFn: () => apiRequest<WorkScheduleTemplate[]>('/schedule-templates'),
  });

  // Create User Mutation
  const createUserMutation = useMutation({
    mutationFn: (body: any) => apiRequest('/users', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setIsAddUserOpen(false);
      setName('');
      setEmail('');
      setDepartment('');
      setManagerId('');
      setFeedback({ type: 'success', message: 'Employee account created successfully!' });
      queryClient.invalidateQueries({ queryKey: ['users-list'] });
    },
    onError: (err) => {
      setFeedback({ type: 'error', message: getFriendlyErrorMessage(err) });
    },
  });

  // Assign Schedule Mutation
  const assignScheduleMutation = useMutation({
    mutationFn: ({ userId, body }: { userId: string; body: any }) =>
      apiRequest(`/users/${userId}/schedule`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setScheduleTarget(null);
      setFeedback({ type: 'success', message: 'Work schedule template assigned successfully!' });
      queryClient.invalidateQueries({ queryKey: ['users-list'] });
    },
    onError: (err) => {
      setFeedback({ type: 'error', message: getFriendlyErrorMessage(err) });
    },
  });

  // Deactivate Mutation
  const deactivateMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/users/${id}/deactivate`, { method: 'PATCH' }),
    onSuccess: () => {
      setFeedback({ type: 'success', message: 'User deactivated.' });
      queryClient.invalidateQueries({ queryKey: ['users-list'] });
    },
    onError: (err) => setFeedback({ type: 'error', message: getFriendlyErrorMessage(err) }),
  });

  // Reactivate Mutation
  const reactivateMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/users/${id}/reactivate`, { method: 'PATCH' }),
    onSuccess: () => {
      setFeedback({ type: 'success', message: 'User reactivated.' });
      queryClient.invalidateQueries({ queryKey: ['users-list'] });
    },
    onError: (err) => setFeedback({ type: 'error', message: getFriendlyErrorMessage(err) }),
  });

  // Reset Password Mutation
  const resetPasswordMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/users/${id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ newPassword: 'DefaultPassword123!' }),
      }),
    onSuccess: () => {
      setFeedback({
        type: 'success',
        message: 'Password reset to DefaultPassword123! (must change on next login).',
      });
    },
    onError: (err) => setFeedback({ type: 'error', message: getFriendlyErrorMessage(err) }),
  });

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    createUserMutation.mutate({
      name,
      email,
      role,
      department: department || undefined,
      managerId: managerId || undefined,
    });
  };

  const handleAssignSchedule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!scheduleTarget || !selectedTemplateId) return;
    assignScheduleMutation.mutate({
      userId: scheduleTarget.id,
      body: { templateId: selectedTemplateId, effectiveFrom },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Workforce Directory</h1>
          <p className="text-xs text-slate-500 mt-1">Manage staff, managers, schedule assignments and credentials</p>
        </div>
        <Button onClick={() => setIsAddUserOpen(true)}>
          <UserPlus className="w-4 h-4 mr-1.5" /> Add Employee
        </Button>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center justify-between ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
            <span>{feedback.message}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="text-xs font-bold px-1">&times;</button>
        </div>
      )}

      {/* Filters Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setPage(1);
            }}
            placeholder="Search by name or email..."
            className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <select
          value={roleFilter}
          onChange={(e) => {
            setRoleFilter(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Roles</option>
          <option value="staff">Staff</option>
          <option value="manager">Manager</option>
        </select>
      </div>

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      )}

      {data && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-semibold">
                <tr>
                  <th className="p-3.5">Employee</th>
                  <th className="p-3.5">Role</th>
                  <th className="p-3.5">Department</th>
                  <th className="p-3.5">Manager</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {safeArray(data?.items, 'users').length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-slate-400">
                      No employees match your search criteria.
                    </td>
                  </tr>
                ) : (
                  safeArray(data?.items, 'users').map((emp) => (
                    <tr key={emp.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="p-3.5 font-medium text-slate-800">
                        <div className="font-semibold text-slate-900">{emp.name}</div>
                        <div className="text-[11px] text-slate-400">{emp.email}</div>
                      </td>
                      <td className="p-3.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border uppercase ${roleBadgeColor(emp.role)}`}>
                          {emp.role}
                        </span>
                      </td>
                      <td className="p-3.5 text-slate-600">{emp.department || '—'}</td>
                      <td className="p-3.5 text-slate-600">{emp.manager?.name || '—'}</td>
                      <td className="p-3.5">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${emp.active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                          {emp.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="p-3.5 text-right space-x-1.5 whitespace-nowrap">
                        <Button
                          variant="outline"
                          size="sm"
                          title="Assign Schedule"
                          onClick={() => {
                            setScheduleTarget(emp);
                            setSelectedTemplateId(templates[0]?.id || '');
                          }}
                        >
                          <Calendar className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          title="Reset Password"
                          onClick={() => resetPasswordMutation.mutate(emp.id)}
                        >
                          <KeyRound className="w-3.5 h-3.5 text-amber-600" />
                        </Button>
                        {emp.active ? (
                          <Button
                            variant="destructive"
                            size="sm"
                            title="Deactivate"
                            onClick={() => deactivateMutation.mutate(emp.id)}
                          >
                            <UserX className="w-3.5 h-3.5" />
                          </Button>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            title="Reactivate"
                            onClick={() => reactivateMutation.mutate(emp.id)}
                          >
                            <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Add User Modal */}
      <Modal
        isOpen={isAddUserOpen}
        onClose={() => setIsAddUserOpen(false)}
        title="Create Employee Account"
        description="Add a new staff or manager user to the organization"
      >
        <form onSubmit={handleCreateUser} className="space-y-4 pt-2">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. John Doe"
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. john@acme.com"
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as any)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white"
              >
                <option value="staff">Staff</option>
                <option value="manager">Manager</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Department</label>
              <input
                type="text"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="e.g. Engineering"
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Reports To (Manager)</label>
            <select
              value={managerId}
              onChange={(e) => setManagerId(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white"
            >
              <option value="">No manager (direct report to owner/HR)</option>
              {safeArray(managersData?.items, 'managers').map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.email})
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => setIsAddUserOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={createUserMutation.isPending}>
              Create User
            </Button>
          </div>
        </form>
      </Modal>

      {/* Assign Schedule Modal */}
      <Modal
        isOpen={!!scheduleTarget}
        onClose={() => setScheduleTarget(null)}
        title="Assign Work Schedule"
        description={`Assign schedule template for ${scheduleTarget?.name}`}
      >
        <form onSubmit={handleAssignSchedule} className="space-y-4 pt-2">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Schedule Template</label>
            <select
              required
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white"
            >
              <option value="">Select a schedule template</option>
              {safeArray(templates, 'templates').map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} (Saturday: {t.saturdayMode})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Effective From Date</label>
            <input
              type="date"
              required
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => setScheduleTarget(null)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={assignScheduleMutation.isPending}>
              Assign Schedule
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
