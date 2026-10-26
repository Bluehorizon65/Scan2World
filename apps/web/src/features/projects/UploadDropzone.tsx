import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ImagePlus, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, uploadFile } from '../../api/client';
import { keys } from '../../api/hooks';
import { Button } from '../../components/ui';
import { formatBytes } from '../../lib/format';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const CONCURRENCY = 3;

interface Item {
  id: string;
  file: File;
  progress: number;
  state: 'queued' | 'uploading' | 'done' | 'failed';
  error?: string;
  abort?: AbortController;
}

export function UploadDropzone({ projectId, maxFileBytes, maxImages }: { projectId: string; maxFileBytes: number; maxImages?: number }) {
  const qc = useQueryClient();
  const [items, setItems] = useState<Item[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const update = (id: string, patch: Partial<Item>) => setItems((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const add = useCallback(
    (files: FileList | File[]) => {
      const accepted: Item[] = [];
      const errors: string[] = [];
      for (const f of Array.from(files)) {
        if (!TYPES.includes(f.type)) errors.push(`${f.name} is not a JPEG, PNG or WebP image.`);
        else if (f.size > maxFileBytes) errors.push(`${f.name} is larger than ${formatBytes(maxFileBytes)}.`);
        else accepted.push({ id: crypto.randomUUID(), file: f, progress: 0, state: 'queued' });
      }
      setRejected(errors);
      setItems((list) => [...list.filter((i) => i.state !== 'done'), ...accepted]);
    },
    [maxFileBytes],
  );

  // Pump the queue: at most CONCURRENCY uploads in flight.
  useEffect(() => {
    const active = items.filter((i) => i.state === 'uploading').length;
    const next = items.filter((i) => i.state === 'queued').slice(0, Math.max(0, CONCURRENCY - active));
    for (const item of next) {
      const abort = new AbortController();
      update(item.id, { state: 'uploading', abort });
      uploadFile(`/projects/${projectId}/uploads`, item.file, (p) => update(item.id, { progress: p }), abort.signal)
        .then(() => {
          update(item.id, { state: 'done', progress: 1 });
          void qc.invalidateQueries({ queryKey: keys.uploads(projectId) });
          void qc.invalidateQueries({ queryKey: keys.project(projectId) });
        })
        .catch((e: unknown) => update(item.id, { state: 'failed', error: e instanceof ApiError ? e.message : 'Upload failed' }));
    }
  }, [items, projectId, qc]);

  const pending = items.filter((i) => i.state === 'queued' || i.state === 'uploading');
  const visible = items.filter((i) => i.state !== 'done');

  return (
    <div className="grid gap-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          add(e.dataTransfer.files);
        }}
        className={clsx(
          'grid place-items-center gap-2 rounded-[var(--radius-panel)] border border-dashed px-6 py-8 text-center transition-colors',
          over ? 'border-brass bg-brass/5' : 'border-line',
        )}
      >
        <ImagePlus className="size-6 text-muted" aria-hidden />
        <p className="text-sm text-ink">Drop overlapping photos of the space here</p>
        <p className="text-xs text-muted">
          JPEG, PNG or WebP, up to {formatBytes(maxFileBytes)} each{maxImages ? `, ${maxImages} per project` : ''}.
        </p>
        <Button size="sm" onClick={() => inputRef.current?.click()}>Choose photos</Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={TYPES.join(',')}
          aria-label="Photo files"
          tabIndex={-1}
          className="sr-only"
          onChange={(e) => {
            if (e.target.files) add(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {rejected.length > 0 && (
        <ul role="alert" className="grid gap-1 text-sm text-danger">
          {rejected.map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}

      {visible.length > 0 && (
        <div className="grid gap-2">
          <div className="flex items-center justify-between text-sm text-muted">
            <span>{pending.length ? `Uploading ${pending.length} photo${pending.length > 1 ? 's' : ''}` : 'Some uploads need attention'}</span>
            {pending.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => { pending.forEach((i) => i.abort?.abort()); setItems((l) => l.map((i) => (i.state === 'queued' ? { ...i, state: 'failed', error: 'Upload cancelled' } : i))); }}>
                Cancel all
              </Button>
            )}
          </div>
          <ul className="grid max-h-60 gap-1 overflow-auto">
            {visible.map((i) => (
              <li key={i.id} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-[var(--radius-control)] bg-canvas px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm">{i.file.name}</p>
                  {i.state === 'failed' ? (
                    <p className="text-xs text-danger">{i.error}</p>
                  ) : (
                    <div role="progressbar" aria-label={`${i.file.name} upload`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(i.progress * 100)} className="mt-1 h-1 overflow-hidden rounded-full bg-raised">
                      <div className="h-full bg-brass" style={{ width: `${i.progress * 100}%` }} />
                    </div>
                  )}
                </div>
                {i.state === 'failed' ? (
                  <Button size="sm" variant="ghost" aria-label={`Retry ${i.file.name}`} onClick={() => update(i.id, { state: 'queued', progress: 0, error: undefined })}>
                    <RotateCcw className="size-3.5" aria-hidden />
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" aria-label={`Cancel ${i.file.name}`} onClick={() => (i.abort ? i.abort.abort() : update(i.id, { state: 'failed', error: 'Upload cancelled' }))}>
                    <X className="size-3.5" aria-hidden />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
