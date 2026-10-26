import clsx from 'clsx';
import { Check, CircleX, RotateCcw, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Job } from '../../api/types';
import { stagesFor } from './stages';
import { Button, StatusBadge } from '../../components/ui';
import { formatDuration, stageLabel } from '../../lib/format';

const LIVE = new Set(['queued', 'validating', 'running', 'processing', 'exporting']);

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function JobTimeline({ job, onCancel, onRetry, busy }: { job: Job; onCancel?: () => void; onRetry?: () => void; busy?: boolean }) {
  const live = LIVE.has(job.status);
  const now = useNow(live);
  const stages = stagesFor(job);
  const current = stages.indexOf(job.stage ?? '');
  const stageStart = (s: string) => job.events?.findLast((e) => e.stage === s)?.createdAt;
  const total = job.startedAt ? (job.completedAt ? new Date(job.completedAt).getTime() : now) - new Date(job.startedAt).getTime() : 0;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <StatusBadge status={job.status} />
          {job.startedAt && <span className="text-sm text-muted">{live ? 'Running for' : 'Took'} {formatDuration(total)}</span>}
        </div>
        <div className="flex gap-2">
          {live && onCancel && (
            <Button size="sm" variant="ghost" onClick={onCancel} loading={busy} disabled={job.status === 'cancelling'}>
              <Square className="size-3.5" aria-hidden /> Cancel job
            </Button>
          )}
          {(job.status === 'failed' || job.status === 'cancelled') && onRetry && (
            <Button size="sm" onClick={onRetry} loading={busy}>
              <RotateCcw className="size-3.5" aria-hidden /> Retry
            </Button>
          )}
        </div>
      </div>

      <ol className="grid gap-0">
        {stages.map((s, i) => {
          const failedHere = job.status === 'failed' && i === Math.max(current, 0);
          const state =
            failedHere ? 'failed'
            : job.status === 'completed' || i < current ? 'done'
            : i === current && live ? 'active'
            : 'pending';
          const started = stageStart(s);
          return (
            <li
              key={s}
              data-state={state}
              aria-current={state === 'active' ? 'step' : undefined}
              className="relative grid grid-cols-[20px_1fr] gap-3 pb-3 last:pb-0"
            >
              <span
                className={clsx(
                  'mt-0.5 grid size-5 place-items-center rounded-full border text-[10px]',
                  state === 'done' && 'border-walkable/50 text-walkable',
                  state === 'active' && 'border-brass text-brass',
                  state === 'failed' && 'border-danger text-danger',
                  state === 'pending' && 'border-line text-faint',
                )}
                aria-hidden
              >
                {state === 'done' ? <Check className="size-3" /> : state === 'failed' ? <CircleX className="size-3" /> : i + 1}
              </span>
              <div className="min-w-0">
                <p className={clsx('text-sm', state === 'pending' ? 'text-faint' : 'text-ink')}>{stageLabel(s)}</p>
                {state === 'active' && (
                  <div className="mt-1 grid gap-1.5">
                    {started && <p className="text-xs text-muted">{formatDuration(now - new Date(started).getTime())} elapsed</p>}
                    {job.progress && (
                      <>
                        <p className="text-xs text-muted">
                          {job.progress.label}: {job.progress.current} of {job.progress.total}
                        </p>
                        <div
                          role="progressbar"
                          aria-label={job.progress.label}
                          aria-valuemin={0}
                          aria-valuemax={job.progress.total}
                          aria-valuenow={job.progress.current}
                          className="h-1 w-full max-w-xs overflow-hidden rounded-full bg-raised"
                        >
                          <div className="h-full bg-brass transition-[width]" style={{ width: `${Math.min(100, (job.progress.current / Math.max(1, job.progress.total)) * 100)}%` }} />
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {job.status === 'failed' && (
        <div role="alert" className="rounded-[var(--radius-panel)] border border-danger/40 bg-danger/10 p-4">
          <p className="text-sm font-medium text-ink">{job.errorMessage ?? 'The job failed.'}</p>
          {job.diagnostics?.advice?.length ? (
            <ul className="mt-2 grid list-disc gap-1 pl-5 text-sm text-muted">
              {job.diagnostics.advice.map((a) => <li key={a}>{a}</li>)}
            </ul>
          ) : null}
          {job.errorCode && <p className="mt-2 text-xs text-faint">Error code: {job.errorCode}</p>}
        </div>
      )}
    </div>
  );
}
