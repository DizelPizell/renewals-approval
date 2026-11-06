import { IsOptional, IsString } from 'class-validator';

export class RejectRequestDto {
  @IsOptional()
  @IsString()
  comment?: string;
}
