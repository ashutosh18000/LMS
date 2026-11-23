import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RejectRequestDto {
  @ApiProperty({
    description: 'Mandatory rejection reason applied to all pending segments',
    example: 'Critical project release scheduled on these dates',
  })
  @IsString({ message: 'comment must be a string' })
  @IsNotEmpty({ message: 'comment is required' })
  @MaxLength(500, { message: 'comment cannot exceed 500 characters' })
  comment!: string;
}
