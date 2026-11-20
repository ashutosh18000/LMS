import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiRequest, getFriendlyErrorMessage } from '../../lib/api-client';
import { useAuth } from '../../context/AuthContext';
import type { User } from '../../types/api';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Modal } from '../../components/ui/modal';
import { ShieldAlert, AlertCircle, CheckCircle2 } from 'lucide-react';

export const TransferOwnershipPage: React.FC = () => {
  const { logout, user } = useAuth();
  const navigate = useNavigate();

  const [newOwnerUserId, setNewOwnerUserId] = useState('');
  const [password, setPassword] = useState('');
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; message: string } | null>(null);

  const { data: usersData } = useQuery<{ items: User[] }>({
    queryKey: ['org-users-transfer'],
    queryFn: () => apiRequest<{ items: User[] }>('/users?limit=100'),
  });

  const transferMutation = useMutation({
    mutationFn: (body: any) =>
      apiRequest('/org/transfer-ownership', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: async () => {
      setIsConfirmOpen(false);
      setFeedback({
        type: 'success',
        message: 'Ownership transferred successfully! Signing you out...',
      });
      setTimeout(async () => {
        await logout();
        navigate('/login');
      }, 1500);
    },
    onError: (err) => {
      setIsConfirmOpen(false);
      setFeedback({ type: 'error', message: getFriendlyErrorMessage(err) });
    },
  });

  const handlePreSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOwnerUserId || !password) {
      setFeedback({ type: 'error', message: 'Please select an employee and enter your password.' });
      return;
    }
    setIsConfirmOpen(true);
  };

  const handleExecuteTransfer = () => {
    transferMutation.mutate({ newOwnerUserId, password });
  };

  const selectedCandidate = usersData?.items?.find((u) => u.id === newOwnerUserId);

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-rose-900">Transfer Organization Ownership</h1>
        <p className="text-xs text-slate-500 mt-1">
          Hand over primary tenant administrator privileges to another active employee
        </p>
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

      <Card className="border-rose-200">
        <CardHeader className="bg-rose-50/50 border-b border-rose-100">
          <div className="flex items-center gap-2 text-rose-800">
            <ShieldAlert className="w-5 h-5 text-rose-600" />
            <CardTitle className="text-sm">Irreversible Administrative Action</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          <form onSubmit={handlePreSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Select Successor (New Owner)
              </label>
              <select
                required
                value={newOwnerUserId}
                onChange={(e) => setNewOwnerUserId(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white"
              >
                <option value="">Select an active employee</option>
                {usersData?.items
                  ?.filter((u) => u.id !== user?.id)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.email}) - {u.role}
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Your Current Password (Verification)
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Confirm with your account password"
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300"
              />
            </div>

            <div className="pt-2">
              <Button type="submit" variant="destructive" className="w-full">
                Review & Confirm Transfer
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Confirmation Modal */}
      <Modal
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        title="Confirm Irreversible Transfer"
        description="Are you absolutely sure you want to transfer ownership?"
      >
        <div className="space-y-4 pt-2 text-xs text-slate-600">
          <p>
            You are about to transfer organization ownership to{' '}
            <strong className="text-slate-900">{selectedCandidate?.name}</strong> ({selectedCandidate?.email}).
          </p>
          <p className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800">
            ⚠️ <strong>Warning:</strong> Your account will be demoted to HR Administrator. All your active login sessions will be terminated and you will be signed out immediately.
          </p>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setIsConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleExecuteTransfer}
              isLoading={transferMutation.isPending}
            >
              Yes, Transfer Ownership Now
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
