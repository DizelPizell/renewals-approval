import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../entities/user.entity';
import { RenewalRequestsService } from './renewal-requests.service';
import { CreateRequestDto } from './dto/create-request.dto';
import { RejectRequestDto } from './dto/reject-request.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class RenewalRequestsController {
  constructor(private service: RenewalRequestsService) {}

  @Get('renewal-requests')
  findAll(@CurrentUser() user: User) {
    return this.service.findAll(user);
  }

  @Post('renewal-requests')
  create(@Body() dto: CreateRequestDto, @CurrentUser() user: User) {
    return this.service.create(dto, user);
  }

  @Post('renewal-requests/:id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: User) {
    return this.service.approve(id, user);
  }

  @Post('renewal-requests/:id/reject')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectRequestDto,
    @CurrentUser() user: User,
  ) {
    return this.service.reject(id, dto, user);
  }

  @Post('renewal-requests/:id/retry')
  retry(@Param('id') id: string, @CurrentUser() user: User) {
    return this.service.retry(id, user);
  }

  @Get('renewal-requests/:id/history')
  history(@Param('id') id: string, @CurrentUser() user: User) {
    return this.service.getHistory(id, user);
  }

  @Get('stats')
  stats(@Query('resource_id') resourceId: string, @CurrentUser() user: User) {
    return this.service.getStats(resourceId, user);
  }
}
