import { create } from 'zustand';

export type ViewMode = 'color' | 'solid' | 'wireframe' | 'points';
export type Projection = 'perspective' | 'orthographic';

export interface LayerStats {
  vertices: number;
  triangles: number;
  points: number;
  min: [number, number, number];
  max: [number, number, number];
}

interface StudioState {
  mode: ViewMode;
  projection: Projection;
  showGrid: boolean;
  showBounds: boolean;
  /** Cull faces pointing away from the camera: with inward-facing scan normals this cuts away near walls. */
  interior: boolean;
  visible: Record<string, boolean>;
  stats: Record<string, LayerStats>;
  errors: Record<string, string>;
  reloadNonce: Record<string, number>;
  fitNonce: number;
  set: (patch: Partial<Pick<StudioState, 'mode' | 'projection' | 'showGrid' | 'showBounds' | 'interior'>>) => void;
  setVisible: (id: string, on: boolean) => void;
  showOnly: (ids: string[]) => void;
  reportStats: (id: string, s: LayerStats) => void;
  reportError: (id: string, message: string) => void;
  retry: (id: string) => void;
  fit: () => void;
}

export const useStudio = create<StudioState>((set) => ({
  mode: 'color',
  projection: 'perspective',
  showGrid: true,
  showBounds: false,
  interior: true,
  visible: {},
  stats: {},
  errors: {},
  reloadNonce: {},
  fitNonce: 0,
  set: (patch) => set(patch),
  setVisible: (id, on) => set((s) => ({ visible: { ...s.visible, [id]: on } })),
  showOnly: (ids) => set({ visible: Object.fromEntries(ids.map((i) => [i, true])), errors: {} }),
  reportStats: (id, stats) => set((s) => ({ stats: { ...s.stats, [id]: stats } })),
  reportError: (id, message) => set((s) => ({ errors: { ...s.errors, [id]: message } })),
  retry: (id) =>
    set((s) => {
      const errors = { ...s.errors };
      delete errors[id];
      return { errors, reloadNonce: { ...s.reloadNonce, [id]: (s.reloadNonce[id] ?? 0) + 1 } };
    }),
  fit: () => set((s) => ({ fitNonce: s.fitNonce + 1 })),
}));

/** Above these, loading in the browser may freeze the tab; the user must opt in. */
export const HEAVY_TRIANGLES = 2_000_000;
export const HEAVY_BYTES = 50 * 1024 * 1024;
