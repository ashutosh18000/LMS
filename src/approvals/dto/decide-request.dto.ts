import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class SegmentDecisionItemDto {
  @ApiProperty({ description: 'ID of the segment to decide', example: 'uuid-segment-id' })
  @IsString({ message: 'segmentId must be a string' })
  @IsNotEmpty({ message: 'segmentId is required' })
  segmentId!: string;

  @ApiProperty({ description: 'Decision action', enum: ['approve', 'reject'], example: 'approve' })
  @IsIn(['approve', 'reject'], { message: "action must be either 'approve' or 'reject'" })
  action!: 'approve' | 'reject';

  @ApiPropertyOptional({
    description: 'Decision comment (required if action is reject, optional if approve)',
    example: 'Approved based on team coverage',
  })
  @IsOptional()
  @IsString({ message: 'comment must be a string' })
  @MaxLength(500, { message: 'comment cannot exceed 500 characters' })
  comment?: string;
}

export class DecideRequestDto {
  @ApiProperty({
    description: 'List of decisions for all pending segments of the request',
    type: [SegmentDecisionItemDto],
  })
  @IsArray({ message: 'decisions must be an array' })
  @ArrayNotEmpty({ message: 'decisions array cannot be empty' })
  @ValidateNested({ each: true })
  @Type(() => SegmentDecisionItemDto)
  decisions!: SegmentDecisionItemDto[];
}
