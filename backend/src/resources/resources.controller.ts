import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ResourcesService } from './resources.service';
import { User } from '../entities/user.entity';

@Controller('resources')
@UseGuards(JwtAuthGuard)
export class ResourcesController {
  constructor(private resourcesService: ResourcesService) {}

  @Get()
  findAll(@CurrentUser() user: User) {
    return this.resourcesService.findByWorkspace(user);
  }
}
