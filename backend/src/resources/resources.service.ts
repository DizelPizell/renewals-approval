import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Resource } from '../entities/resource.entity';
import { User } from '../entities/user.entity';

@Injectable()
export class ResourcesService {
  constructor(
    @InjectRepository(Resource)
    private resourceRepository: Repository<Resource>,
  ) {}

  findByWorkspace(user: User): Promise<Resource[]> {
    return this.resourceRepository.find({
      where: { workspaceId: user.workspaceId },
      order: { id: 'ASC' },
    });
  }

  async findByIdInWorkspace(id: string, user: User): Promise<Resource> {
    const resource = await this.resourceRepository.findOne({ where: { id } });
    if (!resource || resource.workspaceId !== user.workspaceId) {
      throw new ForbiddenException('Resource not found or access denied');
    }
    return resource;
  }
}
