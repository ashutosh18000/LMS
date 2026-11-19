import { Portion } from '@prisma/client';
import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';

export class CreateLeaveSegmentDto {
  @IsUUID('4', { message: 'leaveTypeId must be a valid UUID' })
  @IsNotEmpty({ message: 'leaveTypeId is required' })
  leaveTypeId!: string;

  @IsDateString({}, { message: 'startDate must be a valid ISO date string (YYYY-MM-DD)' })
  @IsNotEmpty({ message: 'startDate is required' })
  startDate!: string;

  @IsDateString({}, { message: 'endDate must be a valid ISO date string (YYYY-MM-DD)' })
  @IsNotEmpty({ message: 'endDate is required' })
  endDate!: string;

  @IsOptional()
  @IsEnum(Portion, { message: 'portion must be full, first_half, or second_half' })
  portion: Portion = Portion.full;
}
