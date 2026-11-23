import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ApproveRequestDto {
  @ApiPropertyOptional({
    description: 'Optional approval comment applied to all pending segments',
    example: 'Approved',
  })
  @IsOptional()
  @IsString({ message: 'comment must be a string' })
  @MaxLength(500, { message: 'comment cannot exceed 500 characters' })
  comment?: string;
}
