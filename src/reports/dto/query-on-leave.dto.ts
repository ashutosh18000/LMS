import { IsDateString, IsOptional, IsString } from 'class-validator';

export class QueryOnLeaveDto {
  @IsOptional()
  @IsDateString({}, { message: 'date must be a valid date string (YYYY-MM-DD)' })
  date?: string;

  @IsOptional()
  @IsString()
  format?: string;
}
