import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export enum UtilizationGroupBy {
  department = 'department',
  leaveType = 'leaveType',
  user = 'user',
}

export class QueryUtilizationDto {
  @IsNotEmpty({ message: 'from date is required' })
  @IsDateString({}, { message: 'from must be a valid date string (YYYY-MM-DD)' })
  from: string;

  @IsNotEmpty({ message: 'to date is required' })
  @IsDateString({}, { message: 'to must be a valid date string (YYYY-MM-DD)' })
  to: string;

  @IsNotEmpty({ message: 'groupBy is required' })
  @IsEnum(UtilizationGroupBy, {
    message: 'groupBy must be one of: department, leaveType, user',
  })
  groupBy: UtilizationGroupBy;

  @IsOptional()
  @IsString()
  format?: string;
}
