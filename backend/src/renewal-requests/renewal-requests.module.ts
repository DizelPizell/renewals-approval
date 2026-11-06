import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RenewalRequestsController } from './renewal-requests.controller';
import { RenewalRequestsService } from './renewal-requests.service';
import { RenewalRequest } from '../entities/renewal-request.entity';
import { RequestHistory } from '../entities/request-history.entity';
import { Resource } from '../entities/resource.entity';

@Module({
  imports: [TypeOrmModule.forFeature([RenewalRequest, RequestHistory, Resource])],
  controllers: [RenewalRequestsController],
  providers: [RenewalRequestsService],
  exports: [RenewalRequestsService],
})
export class RenewalRequestsModule {}
