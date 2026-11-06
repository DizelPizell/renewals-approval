import { Module } from '@nestjs/common';
import { WorkerService } from './worker.service';
import { ProviderModule } from '../provider/provider.module';

@Module({
  imports: [ProviderModule],
  providers: [WorkerService],
})
export class WorkerModule {}
