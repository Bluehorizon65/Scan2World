import { JobStatus } from '@prisma/client';

const NEXT: Record<JobStatus, JobStatus[]> = {
  queued: ['validating', 'running', 'failed', 'cancelling', 'cancelled'],
  validating: ['running', 'failed', 'cancelling'],
  running: ['processing', 'exporting', 'completed', 'failed', 'cancelling'],
  processing: ['exporting', 'completed', 'failed', 'cancelling'],
  exporting: ['completed', 'failed', 'cancelling'],
  cancelling: ['cancelled', 'failed'],
  completed: [],
  failed: [],
  cancelled: [],
};

export const isTerminal = (s: JobStatus) => NEXT[s].length === 0;

/** Same-status moves are allowed for non-terminal states (stage updates within a status). */
export function assertTransition(from: JobStatus, to: JobStatus): void {
  if ((from === to && !isTerminal(from)) || NEXT[from].includes(to)) return;
  throw new Error(`Illegal job transition ${from} -> ${to}`);
}
