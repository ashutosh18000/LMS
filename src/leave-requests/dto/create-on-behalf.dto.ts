import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CreateLeaveSegmentDto } from './create-leave-segment.dto';

export class CreateOnBehalfDto {
  @IsUUID('4', { message: 'userId must be a valid UUID' })
  @IsNotEmpty({ message: 'userId is required' })
  userId!: string;

  @IsString({ message: 'reason must be a string' })
  @IsNotEmpty({ message: 'reason is required' })
  @MaxLength(500, { message: 'reason cannot exceed 500 characters' })
  reason!: string;

  @IsString({ message: 'onBehalfReason must be a string' })
  @IsNotEmpty({ message: 'onBehalfReason is required' })
  @MaxLength(500, { message: 'onBehalfReason cannot exceed 500 characters' })
  onBehalfReason!: string;

  @IsOptional()
  @IsBoolean({ message: 'autoApprove must be a boolean' })
  autoApprove?: boolean = true;

  @IsArray({ message: 'segments must be an array' })
  @ArrayMinSize(1, { message: 'At least 1 segment is required' })
  @ArrayMaxSize(10, { message: 'Maximum 10 segments allowed per request' })
  @ValidateNested({ each: true })
  @Type(() => CreateLeaveSegmentDto)
  segments!: CreateLeaveSegmentDto[];
}
