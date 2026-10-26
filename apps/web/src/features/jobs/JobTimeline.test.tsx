import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Job } from '../../api/types';
import { JobTimeline } from './JobTimeline';

const base: Job = {
  id: 'j1', projectId: 'p1', kind: 'reconstruction', status: 'running', stage: 'feature_matching',
  configuration: { quality: 'draft' }, sourceAssetId: null, startedAt: new Date(Date.now() - 65_000).toISOString(),
  completedAt: null, errorCode: null, errorMessage: null, diagnostics: {}, progress: null, resultManifest: null,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  events: [
    { id: 'e1', status: 'queued', stage: null, message: 'Job queued', createdAt: new Date(Date.now() - 70_000).toISOString() },
    { id: 'e2', status: 'validating', stage: 'validation', message: null, createdAt: new Date(Date.now() - 66_000).toISOString() },
    { id: 'e3', status: 'running', stage: 'feature_extraction', message: null, createdAt: new Date(Date.now() - 65_000).toISOString() },
    { id: 'e4', status: 'running', stage: 'feature_matching', message: null, createdAt: new Date(Date.now() - 20_000).toISOString() },
  ],
};

describe('JobTimeline', () => {
  it('shows the current stage and elapsed time but no invented percentage', () => {
    render(<JobTimeline job={base} />);
    const current = screen.getByRole('listitem', { current: 'step' });
    expect(within(current).getByText('Matching features')).toBeInTheDocument();
    expect(within(current).getByText(/\d+s elapsed/)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map((li) => li.getAttribute('data-state'))).toEqual(
      expect.arrayContaining(['done', 'active', 'pending']),
    );
    // dense stages are only shown when the job actually runs them
    expect(screen.queryByText('Estimating depth')).not.toBeInTheDocument();
  });

  it('shows measured progress counts when the pipeline reports them', () => {
    render(<JobTimeline job={{ ...base, stage: 'sparse_reconstruction', progress: { label: 'Images registered', current: 12, total: 30 } }} />);
    expect(screen.getByText('Images registered: 12 of 30')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '12');
  });

  it('shows dense stages when the job reports dense reconstruction', () => {
    render(<JobTimeline job={{ ...base, diagnostics: { dense: true, gpu: true } }} />);
    expect(screen.getByText('Estimating depth')).toBeInTheDocument();
  });

  it('explains failures with advice and offers retry', async () => {
    const onRetry = vi.fn();
    const failed: Job = {
      ...base, status: 'failed', stage: 'sparse_reconstruction', errorCode: 'sparse_reconstruction_failed',
      errorMessage: 'Camera poses could not be recovered.', diagnostics: { advice: ['Capture in one continuous loop.'] },
    };
    render(<JobTimeline job={failed} onRetry={onRetry} />);
    expect(screen.getByText('Camera poses could not be recovered.')).toBeInTheDocument();
    expect(screen.getByText('Capture in one continuous loop.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('offers cancel only while the job is live', async () => {
    const onCancel = vi.fn();
    const { rerender } = render(<JobTimeline job={base} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel job' }));
    expect(onCancel).toHaveBeenCalled();
    rerender(<JobTimeline job={{ ...base, status: 'completed', stage: 'export_validation' }} onCancel={onCancel} />);
    expect(screen.queryByRole('button', { name: 'Cancel job' })).not.toBeInTheDocument();
  });
});
