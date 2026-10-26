import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, type SessionUser } from '../auth/auth.guard';
import { UuidPipe } from '../common/uuid.pipe';
import { CreateProjectDto, ListProjectsQuery, UpdateProjectDto } from './projects.dto';
import { ProjectsService } from './projects.service';

@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(private projects: ProjectsService) {}

  @Post()
  create(@CurrentUser() user: SessionUser, @Body() dto: CreateProjectDto) {
    return this.projects.create(user.id, dto);
  }

  @Get()
  list(@CurrentUser() user: SessionUser, @Query() query: ListProjectsQuery) {
    return this.projects.list(user.id, query);
  }

  @Get(':id')
  get(@CurrentUser() user: SessionUser, @Param('id', new UuidPipe('Project')) id: string) {
    return this.projects.getOwned(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: SessionUser,
    @Param('id', new UuidPipe('Project')) id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projects.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: SessionUser, @Param('id', new UuidPipe('Project')) id: string) {
    return this.projects.remove(user.id, id);
  }
}
