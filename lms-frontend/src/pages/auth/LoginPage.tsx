import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getFriendlyErrorMessage } from '../../lib/api-client';
import { Button } from '../../components/ui/button';
import { Calendar, Shield, Sparkles, User, AlertCircle } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const demoMode = import.meta.env.VITE_DEMO_MODE === 'true';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setErrorMessage('Please enter both email and password.');
      return;
    }

    setErrorMessage(null);
    setIsLoading(true);

    try {
      const user = await login(email, password);
      if (user.mustChangePassword) {
        navigate('/change-password');
      } else if (user.role === 'root') {
        navigate('/platform/organizations');
      } else {
        const from = (location.state as any)?.from?.pathname || '/dashboard';
        navigate(from, { replace: true });
      }
    } catch (err: any) {
      setErrorMessage(getFriendlyErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickFill = (demoEmail: string, demoPass = 'DemoPassword123!') => {
    setEmail(demoEmail);
    setPassword(demoPass);
    setErrorMessage(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl p-8 border border-slate-100">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-500/30 mb-4">
            <Calendar className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Sign in to LMS</h1>
          <p className="text-xs text-slate-500 mt-1">Multi-tenant Leave Management System</p>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="mb-6 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="leading-relaxed">{errorMessage}</div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. staff1@acme.com"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-slate-700">Password</label>
            </div>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            />
          </div>

          <Button type="submit" className="w-full mt-2" isLoading={isLoading}>
            Sign In
          </Button>
        </form>

        {/* Demo Logins Section */}
        {demoMode && (
          <div className="mt-8 pt-6 border-t border-slate-100">
            <div className="flex items-center gap-1.5 mb-3 text-xs font-semibold text-slate-700">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>Demo Quick Fill Logins</span>
            </div>
            <p className="text-[11px] text-slate-400 mb-3">
              One-click preset credentials for demo showcase:
            </p>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                onClick={() => handleQuickFill('owner@acme.com')}
                className="flex items-center gap-2 p-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-amber-50 hover:border-amber-200 text-slate-700 transition-colors text-left"
              >
                <Shield className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <div className="truncate">
                  <div className="font-semibold text-[11px]">Org Owner</div>
                  <div className="text-[10px] text-slate-400 truncate">owner@acme.com</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickFill('hr@acme.com')}
                className="flex items-center gap-2 p-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-blue-50 hover:border-blue-200 text-slate-700 transition-colors text-left"
              >
                <User className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <div className="truncate">
                  <div className="font-semibold text-[11px]">HR Admin</div>
                  <div className="text-[10px] text-slate-400 truncate">hr@acme.com</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickFill('manager1@acme.com')}
                className="flex items-center gap-2 p-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-emerald-50 hover:border-emerald-200 text-slate-700 transition-colors text-left"
              >
                <User className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <div className="truncate">
                  <div className="font-semibold text-[11px]">Manager</div>
                  <div className="text-[10px] text-slate-400 truncate">manager1@acme.com</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickFill('staff1@acme.com')}
                className="flex items-center gap-2 p-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-purple-50 hover:border-purple-200 text-slate-700 transition-colors text-left"
              >
                <User className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                <div className="truncate">
                  <div className="font-semibold text-[11px]">Staff</div>
                  <div className="text-[10px] text-slate-400 truncate">staff1@acme.com</div>
                </div>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
