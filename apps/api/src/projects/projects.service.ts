import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { notFound } from '../common/app-error';
import { PrismaService } from '../prisma.service';
import { PythonClient } from '../internal/python-client';
import { StorageService } from '../storage/storage.service';
import { CreateProjectDto, ListProjectsQuery, UpdateProjectDto } from './projects.dto';

const summary = {
  _count: { select: { uploads: true, assets: true, jobs: true } },
  jobs: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { id: true, kind: true, status: true, stage: true, createdAt: true },
  },
} satisfies Prisma.ProjectInclude;

@Injectable()
export class ProjectsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private python: PythonClient,
  ) {}

  /** The single ownership gate: missing and not-owned are both 404. */
  async getOwned(userId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, ownerId: userId },
      include: summary,
    });
    if (!project) throw notFound('Project');
    return project;
  }

  create(userId: string, dto: CreateProjectDto) {
    return this.prisma.project.create({ data: { ...dto, ownerId: userId }, include: summary });
  }

  async list(userId: string, { q, page, pageSize }: ListProjectsQuery) {
    const where: Prisma.ProjectWhereInput = {
      ownerId: userId,
      ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        include: summary,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.project.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async update(userId: string, projectId: string, dto: UpdateProjectDto) {
    const project = await this.getOwned(userId, projectId);
    const settings = dto.settings ? { ...(project.settings as object), ...dto.settings } : undefined;
    return this.prisma.project.update({ where: { id: projectId }, data: { ...dto, settings }, include: summary });
  }

  async remove(userId: string, projectId: string) {
    await this.getOwned(userId, projectId);
    // Stop COLMAP for live reconstructions first, or it keeps running and recreates files under the deleted project.
    const live = await this.prisma.job.findMany({
      where: { projectId, kind: 'reconstruction', status: { notIn: ['completed', 'failed', 'cancelled'] } },
      select: { id: true },
    });
    await Promise.all(
      live.map((j) =>
        this.python.call('recon', 'DELETE', `/jobs/${j.id}`, undefined, { retries: 0 }).catch(() => undefined),
      ),
    );
    await this.prisma.project.delete({ where: { id: projectId } });
    await this.storage.remove(`projects/${projectId}`);
  }
}
