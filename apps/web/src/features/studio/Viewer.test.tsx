import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import type { Asset } from '../../api/types';
import { isHeavy } from './layers';
import { Inspector } from './StudioPage';

const asset = (over: Partial<Asset> = {}): Asset => ({
  id: 'a1', projectId: 'p', jobId: 'j', parentAssetId: null, name: 'Reconstructed mesh', assetType: 'mesh_visual', format: 'glb',
  sizeBytes: 2_000_000, createdAt: new Date().toISOString(),
  metadata: { kind: 'mesh', triangles: 94_000, vertices: 47_000, dimensions: [11.39, 5.76, 9.68], components: 3, watertight: false, hasColors: true, lowDetail: true },
  ...over,
});

function Boom(): never {
  throw new Error('HTTP 404 Not Found');
}

describe('viewer', () => {
  it('error boundary shows a recoverable error instead of a blank viewport', async () => {
    let reset = () => {};
    render(
      <ErrorBoundary fallback={(e, r) => { reset = r; return <p role="alert">Could not load: {e.message}</p>; }}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load: HTTP 404 Not Found');
    expect(typeof reset).toBe('function');
  });

  it('inspector shows real geometry stats, units and honesty notices', () => {
    render(<Inspector asset={asset()} assets={[asset()]} />);
    expect(screen.getByText('94,000')).toBeInTheDocument();
    expect(screen.getByText('11.39 × 5.76 × 9.68')).toBeInTheDocument();
    expect(screen.getByText('Size (units)')).toBeInTheDocument();
    expect(screen.getByText('Vertex colours')).toBeInTheDocument();
    expect(screen.getByText(/No real-world scale yet/)).toBeInTheDocument();
    expect(screen.getByText('Low-detail mesh')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Download GLB/ })).toHaveAttribute('href', '/api/v1/assets/a1/download');
  });

  it('flags models too heavy to load without confirmation', () => {
    expect(isHeavy(asset())).toBe(false);
    expect(isHeavy(asset({ metadata: { triangles: 3_000_000 } }))).toBe(true);
    expect(isHeavy(asset({ sizeBytes: 80 * 1024 * 1024 }))).toBe(true);
  });

  it('scaled meshes report metres', () => {
    render(<Inspector asset={asset({ metadata: { kind: 'mesh', triangles: 10, dimensions: [6, 3, 5], scaled: true, aligned: true } })} assets={[]} />);
    expect(screen.getByText('Size (m)')).toBeInTheDocument();
    expect(screen.getByText('Floor-aligned, +Y up')).toBeInTheDocument();
    void userEvent;
  });
});

describe('model load error messages', () => {
  it('are plain language and never echo raw URLs or loader internals', async () => {
    const { loadErrorMessage } = await import('./layers');
    expect(loadErrorMessage(new Error('fetch for "/api/v1/assets/x/download" responded with 404: Not Found'))).toBe('the file is missing.');
    expect(loadErrorMessage(new Error('Unexpected token g in JSON at position 0'))).toBe('the file is not a valid 3D model.');
    const generic = loadErrorMessage(new Error('Could not load /api/v1/assets/x/download: Failed to fetch'));
    expect(generic).toBe('the download failed or the file is damaged. Retry, or re-run the step that produced it.');
    expect(generic).not.toContain('/api');
  });
});
