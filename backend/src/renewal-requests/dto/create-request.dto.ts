import { IsString, MinLength } from 'class-validator';

export class CreateRequestDto {
  @IsString()
  @MinLength(1)
  resourceId: string;
}
