import React, { type ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', isLoading = false, disabled, children, ...props }, ref) => {
    const base = 'inline-flex items-center justify-center font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:pointer-events-none disabled:opacity-50 select-none';

    const variants = {
      default: 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm',
      destructive: 'bg-rose-600 text-white hover:bg-rose-700 shadow-sm',
      outline: 'border border-slate-300 bg-white hover:bg-slate-50 text-slate-700',
      secondary: 'bg-slate-100 text-slate-900 hover:bg-slate-200',
      ghost: 'hover:bg-slate-100 text-slate-700',
      link: 'text-blue-600 underline-offset-4 hover:underline p-0 h-auto',
    };

    const sizes = {
      default: 'h-10 px-4 py-2 text-sm gap-2',
      sm: 'h-8 px-3 text-xs gap-1.5',
      lg: 'h-12 px-6 text-base gap-2.5',
      icon: 'h-10 w-10 p-2',
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(base, variants[variant], sizes[size], className)}
        {...props}
      >
        {isLoading && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';
