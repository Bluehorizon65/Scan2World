import type { Job } from '../../api/types';

/** The stages this particular job goes through (dense stages only when it really runs them). */
export function stagesFor(job: Job): string[] {
  if (job.kind === 'reconstruction') {
    const dense = job.diagnostics?.dense === true;
    return [
      'validation', 'feature_extraction', 'feature_matching', 'sparse_reconstruction',
      ...(dense ? ['undistortion', 'dense_stereo', 'fusion'] : []),
      'meshing', 'export_validation',
    ];
  }
  const work = { processing: 'mesh_processing', gamemap: 'gamemap_preparation', export: 'export_packaging' }[job.kind];
  return ['validation', work, 'export_validation'];
}
