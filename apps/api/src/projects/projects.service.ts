import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { notFound } from '../common/app-error';
import { PrismaService } from '../prisma.service';
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
  constructor(private prisma: PrismaService) {}

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
    await this.prisma.project.delete({ where: { id: projectId } });
  }
}
