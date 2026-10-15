import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/cn';

export function Button({
  className,
  variant = 'primary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  return (
    <button
      className={cn(
        'inline-flex h-10 items-center justify-center gap-2 rounded-brand px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-primary text-on-primary shadow-sm hover:bg-primary-hover',
        variant === 'secondary' && 'border border-line bg-surface text-fg hover:bg-fill-quaternary',
        variant === 'ghost' && 'text-fg-secondary hover:bg-fill-tertiary',
        variant === 'danger' && 'bg-error text-on-primary hover:bg-error-hover',
        className,
      )}
      {...props}
    />
  );
}
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-brand-lg border border-line-secondary bg-surface shadow-sm', className)} {...props} />
  );
}
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-10 w-full rounded-brand border border-line bg-surface px-3 text-sm ring-primary/20 outline-none focus:border-primary focus:ring-4',
        className,
      )}
      {...props}
    />
  );
}
export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-10 rounded-brand border border-line bg-surface px-3 text-sm outline-none focus:border-primary',
        className,
      )}
      {...props}
    />
  );
}
export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full resize-none rounded-brand-lg border border-line bg-surface px-4 py-3 text-sm ring-primary/20 outline-none focus:border-primary focus:ring-4',
        className,
      )}
      {...props}
    />
  );
}
export function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'success' | 'error' | 'warning' | 'primary';
}) {
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2 py-1 text-[11px] font-semibold',
        tone === 'neutral' && 'bg-fill-secondary text-fg-secondary',
        tone === 'success' && 'bg-success-soft text-success-text',
        tone === 'error' && 'bg-error-soft text-error-text',
        tone === 'warning' && 'bg-warning-soft text-warning-text',
        tone === 'primary' && 'bg-primary-soft text-primary-text',
      )}
    >
      {children}
    </span>
  );
}
