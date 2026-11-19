import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CreateLeaveSegmentDto } from './create-leave-segment.dto';

export class CreateLeaveRequestDto {
  @IsString({ message: 'reason must be a string' })
  @IsNotEmpty({ message: 'reason is required' })
  @MaxLength(500, { message: 'reason cannot exceed 500 characters' })
  reason!: string;

  @IsArray({ message: 'segments must be an array' })
  @ArrayMinSize(1, { message: 'At least 1 segment is required' })
  @ArrayMaxSize(10, { message: 'Maximum 10 segments allowed per request' })
  @ValidateNested({ each: true })
  @Type(() => CreateLeaveSegmentDto)
  segments!: CreateLeaveSegmentDto[];
}
