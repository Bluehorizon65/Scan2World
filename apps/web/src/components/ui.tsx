import * as Dialog from '@radix-ui/react-dialog';
import clsx from 'clsx';
import { AlertTriangle, CircleAlert, Info, Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import type { JobStatus } from '../api/types';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-brass text-canvas hover:bg-brass-strong font-semibold',
  secondary: 'bg-raised text-ink border border-line hover:border-faint',
  ghost: 'text-muted hover:text-ink hover:bg-raised',
  danger: 'bg-danger/15 text-danger border border-danger/40 hover:bg-danger/25',
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean }
>(({ variant = 'secondary', size = 'md', loading, className, children, disabled, ...props }, ref) => (
  <button
    ref={ref}
    disabled={disabled || loading}
    className={clsx(
      'inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
      size === 'sm' ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-base',
      VARIANT[variant],
      className,
    )}
    {...props}
  >
    {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
    {children}
  </button>
));
Button.displayName = 'Button';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  ({ className, invalid, ...props }, ref) => (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={clsx(
        'h-10 w-full rounded-[var(--radius-control)] border bg-canvas px-3 text-base text-ink placeholder:text-faint',
        invalid ? 'border-danger' : 'border-line focus:border-brass',
        'outline-none focus-visible:outline-none',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export function Field({ label, error, hint, htmlFor, children }: { label: string; error?: string; hint?: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

const NOTICE = {
  info: { icon: Info, cls: 'border-line bg-panel text-muted' },
  warning: { icon: AlertTriangle, cls: 'border-warning/40 bg-warning/10 text-ink' },
  error: { icon: CircleAlert, cls: 'border-danger/40 bg-danger/10 text-ink' },
};

export function Notice({ tone = 'info', title, children }: { tone?: keyof typeof NOTICE; title?: string; children?: ReactNode }) {
  const { icon: Icon, cls } = NOTICE[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={clsx('flex gap-3 rounded-[var(--radius-panel)] border p-3 text-sm', cls)}>
      <Icon className={clsx('mt-0.5 size-4 shrink-0', tone === 'error' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-muted')} aria-hidden />
      <div className="grid gap-1">
        {title && <p className="font-medium text-ink">{title}</p>}
        {children && <div className="text-muted">{children}</div>}
      </div>
    </div>
  );
}

const STATUS_STYLE: Record<JobStatus, string> = {
  queued: 'text-muted border-line',
  validating: 'text-brass border-brass/40',
  running: 'text-brass border-brass/40',
  processing: 'text-brass border-brass/40',
  exporting: 'text-brass border-brass/40',
  completed: 'text-walkable border-walkable/40',
  failed: 'text-danger border-danger/40',
  cancelling: 'text-muted border-line',
  cancelled: 'text-muted border-line',
};

export function StatusBadge({ status }: { status: JobStatus }) {
  const live = ['validating', 'running', 'processing', 'exporting'].includes(status);
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs capitalize', STATUS_STYLE[status])}>
      {live && <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden />}
      {status}
    </span>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center gap-2 text-sm text-muted">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function ConfirmDialog({
  trigger, title, description, confirmLabel, onConfirm, busy,
}: { trigger: ReactNode; title: string; description: string; confirmLabel: string; onConfirm: () => void; busy?: boolean }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-panel)] border border-line bg-panel p-6 shadow-2xl">
          <Dialog.Title className="font-heading text-lg">{title}</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-muted">{description}</Dialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="ghost">Keep it</Button>
            </Dialog.Close>
            <Button variant="danger" loading={busy} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Panel({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('rounded-[var(--radius-panel)] border border-line bg-panel', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-3">
          {typeof title === 'string' ? <h2 className="font-heading text-base">{title}</h2> : title}
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm text-ink">{value}</dd>
    </div>
  );
}
