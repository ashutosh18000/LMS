import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, getFriendlyErrorMessage } from '../../lib/api-client';
import { safeArray } from '../../lib/safe-data';
import type { Organization } from '../../types/api';
import { formatCalendarDate } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { Modal } from '../../components/ui/modal';
import { Plus, Shield, Ban, CheckCircle2, KeyRound, AlertCircle, Building2 } from 'lucide-react';

export const PlatformOrganizationsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [suspendTarget, setSuspendTarget] = useState<Organization | null>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; message: string } | null>(null);

  // New Org Form
  const [orgName, setOrgName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('OwnerSecret123!');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [fyStartMonth, setFyStartMonth] = useState(4);

  const { data: rawOrgsData, isLoading, error } = useQuery<any>({
    queryKey: ['platform-orgs'],
    queryFn: () => apiRequest('/platform/organizations'),
  });
  const orgs: Organization[] = safeArray(rawOrgsData, 'organizations');

  // Create Org Mutation
  const createMutation = useMutation({
    mutationFn: (body: any) =>
      apiRequest('/platform/organizations', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setIsCreateOpen(false);
      setOrgName('');
      setOwnerEmail('');
      setOwnerName('');
      setFeedback({ type: 'success', message: 'Organization & Owner provisioned successfully!' });
      queryClient.invalidateQueries({ queryKey: ['platform-orgs'] });
    },
    onError: (err) => setFeedback({ type: 'error', message: getFriendlyErrorMessage(err) }),
  });

  // Suspend Mutation
  const suspendMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiRequest(`/platform/organizations/${id}/suspend`, {
        method: 'PATCH',
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      setSuspendTarget(null);
      setSuspendReason('');
      setFeedback({ type: 'success', message: 'Organization suspended. All user tokens revoked.' });
      queryClient.invalidateQueries({ queryKey: ['platform-orgs'] });
    },
    onError: (err) => setFeedback({ type: 'error', message: getFriendlyErrorMessage(err) }),
  });

  // Activate Mutation
  const activateMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/platform/organizations/${id}/activate`, {
        method: 'PATCH',
        body: JSON.stringify({ reason: 'Reactivated by platform root admin' }),
      }),
    onSuccess: () => {
      setFeedback({ type: 'success', message: 'Organization reactivated.' });
      queryClient.invalidateQueries({ queryKey: ['platform-orgs'] });
    },
    onError: (err) => setFeedback({ type: 'error', message: getFriendlyErrorMessage(err) }),
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      name: orgName.trim(),
      ownerEmail: ownerEmail.trim(),
      ownerName: ownerName.trim(),
      ownerPassword,
      timezone,
      financialYearStartMonth: Number(fyStartMonth),
    });
  };

  const handleConfirmSuspend = () => {
    if (!suspendReason.trim() || !suspendTarget) return;
    suspendMutation.mutate({ id: suspendTarget.id, reason: suspendReason.trim() });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Platform Tenants</h1>
          <p className="text-xs text-slate-500 mt-1">
            Root Super-Administrator &bull; Multi-tenant organization provisioning & suspension
          </p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} className="bg-purple-600 hover:bg-purple-700 shadow-sm shadow-purple-500/20">
          <Plus className="w-4 h-4 mr-1.5" /> Provision Organization
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

      {isLoading && <Skeleton className="h-64 rounded-2xl" />}

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Failed to load platform organizations.</span>
        </div>
      )}

      {orgs.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {orgs.map((org) => (
            <Card key={org.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="p-5 space-y-3.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-purple-600" />
                    <h3 className="font-bold text-slate-900 text-sm">{org.name}</h3>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase ${
                      org.status === 'active'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-rose-50 text-rose-700 border-rose-200'
                    }`}
                  >
                    {org.status}
                  </span>
                </div>

                <div className="space-y-1 text-xs text-slate-600">
                  <div>
                    <span className="text-slate-400">Primary Owner:</span>{' '}
                    <strong className="text-slate-800">{org.owner?.name || 'Assigned'}</strong>{' '}
                    <span className="text-slate-400">({org.owner?.email})</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Timezone:</span> {org.timezone} &bull;{' '}
                    <span className="text-slate-400">FY Start:</span> Month {org.financialYearStartMonth}
                  </div>
                  <div>
                    <span className="text-slate-400">Total Users:</span>{' '}
                    <strong>{org._count?.users ?? '—'}</strong>
                  </div>
                  <div className="text-[10px] text-slate-400 pt-1">
                    Created on {formatCalendarDate(org.createdAt)}
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                  {org.status === 'active' ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        setSuspendTarget(org);
                        setSuspendReason('');
                      }}
                    >
                      <Ban className="w-3.5 h-3.5 mr-1" /> Suspend Tenant
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => activateMutation.mutate(org.id)}
                      isLoading={activateMutation.isPending}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-600" /> Activate
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Provision Modal */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Provision New Organization & Owner"
        description="Creates an isolated tenant database partition and owner account"
      >
        <form onSubmit={handleCreate} className="space-y-4 pt-2">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Organization Name
            </label>
            <input
              type="text"
              required
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="e.g. Acme Technologies"
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Owner Full Name
              </label>
              <input
                type="text"
                required
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder="e.g. Alice Smith"
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Owner Email
              </label>
              <input
                type="email"
                required
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                placeholder="e.g. alice@acme.com"
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Owner Initial Password
            </label>
            <input
              type="password"
              required
              value={ownerPassword}
              onChange={(e) => setOwnerPassword(e.target.value)}
              placeholder="Initial password"
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Timezone</label>
              <input
                type="text"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                FY Start Month
              </label>
              <select
                value={fyStartMonth}
                onChange={(e) => setFyStartMonth(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white"
              >
                <option value={1}>1 (January)</option>
                <option value={4}>4 (April)</option>
                <option value={7}>7 (July)</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={createMutation.isPending}>
              Provision Tenant
            </Button>
          </div>
        </form>
      </Modal>

      {/* Suspend Modal */}
      <Modal
        isOpen={!!suspendTarget}
        onClose={() => setSuspendTarget(null)}
        title="Suspend Organization"
        description={`Suspend ${suspendTarget?.name}`}
      >
        <div className="space-y-4 pt-2">
          <p className="text-xs text-slate-600">
            Suspending this organization will revoke all active refresh tokens for all its users and block logins.
          </p>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Suspension Justification Reason <span className="text-rose-500">*</span>
            </label>
            <textarea
              required
              rows={2}
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              placeholder="e.g. Subscription expired, non-payment, compliance violation..."
              className="w-full p-2.5 text-xs rounded-xl border border-slate-300"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setSuspendTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleConfirmSuspend}
              isLoading={suspendMutation.isPending}
            >
              Confirm Suspension
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
