import { JobStatus } from '@prisma/client';
import { assertTransition, isTerminal } from './state-machine';

describe('job state machine', () => {
  const legal: [JobStatus, JobStatus][] = [
    ['queued', 'validating'],
    ['queued', 'cancelled'],
    ['validating', 'running'],
    ['running', 'running'],
    ['running', 'processing'],
    ['processing', 'exporting'],
    ['processing', 'completed'],
    ['exporting', 'completed'],
    ['running', 'failed'],
    ['running', 'cancelling'],
    ['cancelling', 'cancelled'],
    ['cancelling', 'failed'],
  ];
  it.each(legal)('%s -> %s is allowed', (from, to) => expect(() => assertTransition(from, to)).not.toThrow());

  const illegal: [JobStatus, JobStatus][] = [
    ['completed', 'running'],
    ['cancelled', 'queued'],
    ['failed', 'completed'],
    ['queued', 'completed'],
    ['cancelling', 'running'],
    ['completed', 'completed'],
    ['validating', 'completed'],
  ];
  it.each(illegal)('%s -> %s throws', (from, to) =>
    expect(() => assertTransition(from, to)).toThrow(`Illegal job transition ${from} -> ${to}`),
  );

  it('identifies terminal states', () => {
    expect(['completed', 'failed', 'cancelled'].every((s) => isTerminal(s as JobStatus))).toBe(true);
    expect(isTerminal('cancelling')).toBe(false);
  });
});
