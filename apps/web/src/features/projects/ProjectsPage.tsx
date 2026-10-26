import * as Dialog from '@radix-ui/react-dialog';
import { zodResolver } from '@hookform/resolvers/zod';
import { FolderPlus, Search } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { useCreateProject, useProjects } from '../../api/hooks';
import type { Project } from '../../api/types';
import { Button, Field, Input, Notice, Spinner, StatusBadge } from '../../components/ui';
import { formatRelative } from '../../lib/format';

const schema = z.object({ name: z.string().trim().min(1, 'Give the project a name').max(120), description: z.string().max(2000).optional() });

function NewProjectDialog() {
  const create = useCreateProject();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, formState, reset } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <Dialog.Trigger asChild>
        <Button variant="primary"><FolderPlus className="size-4" aria-hidden /> New project</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-panel)] border border-line bg-panel p-6">
          <Dialog.Title className="font-heading text-lg">New project</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted">One project per physical space, such as a room or a corridor.</Dialog.Description>
          <form noValidate className="mt-5 grid gap-4" onSubmit={handleSubmit((v) => create.mutate(v, { onSuccess: (p) => navigate(`/projects/${p.id}`) }))}>
            <Field label="Name" htmlFor="name" error={formState.errors.name?.message}>
              <Input id="name" autoFocus placeholder="Living room" invalid={!!formState.errors.name} {...register('name')} />
            </Field>
            <Field label="Notes" htmlFor="description" hint="Optional. Lighting, camera used, anything worth remembering.">
              <textarea id="description" rows={3} className="w-full rounded-[var(--radius-control)] border border-line bg-canvas p-3 text-base focus:border-brass" {...register('description')} />
            </Field>
            {create.error && <Notice tone="error">{create.error.message}</Notice>}
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild><Button variant="ghost">Cancel</Button></Dialog.Close>
              <Button type="submit" variant="primary" loading={create.isPending}>Create project</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function stepOf(p: Project) {
  if (p._count.assets > 0) return 'Has 3D results';
  if (p.validation) return `Photos checked: ${p.validation.rating}`;
  if (p._count.uploads > 0) return `${p._count.uploads} photo${p._count.uploads > 1 ? 's' : ''}`;
  return 'No photos yet';
}

export function ProjectsPage() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const projects = useProjects(q, page);
  const data = projects.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl">Projects</h1>
          <p className="mt-1 text-sm text-muted">Each project holds the photos, reconstructions and exports for one space.</p>
        </div>
        <NewProjectDialog />
      </div>

      <div className="relative mt-6 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
        <Input aria-label="Search projects" placeholder="Search by name" className="pl-9" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      </div>

      <div className="mt-6">
        {projects.isPending ? <Spinner label="Loading projects" />
        : projects.error ? <Notice tone="error" title="Could not load projects">{projects.error.message}</Notice>
        : data!.items.length === 0 ? (
          <div className="grid justify-items-start gap-3 rounded-[var(--radius-panel)] border border-dashed border-line p-8">
            <p className="font-heading text-lg">{q ? `No projects match “${q}”` : 'Start with a room you can photograph'}</p>
            <p className="max-w-[60ch] text-sm text-muted">
              {q ? 'Try a different name.' : 'Create a project, then add 30–80 overlapping photos taken while walking around the space.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-line">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-panel text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">Name</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Progress</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Latest job</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {data!.items.map((p) => (
                  <tr key={p.id} className="border-t border-line hover:bg-panel/60">
                    <td className="px-4 py-3">
                      <Link to={`/projects/${p.id}`} className="font-medium text-ink hover:text-brass">{p.name}</Link>
                      {p.description && <p className="max-w-[48ch] truncate text-xs text-muted">{p.description}</p>}
                    </td>
                    <td className="px-4 py-3 text-muted">{stepOf(p)}</td>
                    <td className="px-4 py-3">{p.jobs[0] ? <span className="flex items-center gap-2"><StatusBadge status={p.jobs[0].status} /><span className="text-xs capitalize text-muted">{p.jobs[0].kind}</span></span> : <span className="text-muted">—</span>}</td>
                    <td className="px-4 py-3 text-muted">{formatRelative(p.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && pages > 1 && (
          <nav aria-label="Pagination" className="mt-4 flex items-center gap-3 text-sm text-muted">
            <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <span>Page {page} of {pages}</span>
            <Button size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
          </nav>
        )}
      </div>
    </div>
  );
}
