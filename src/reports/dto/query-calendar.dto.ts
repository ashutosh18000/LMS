import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class QueryCalendarDto {
  @IsNotEmpty({ message: 'from date is required' })
  @IsDateString({}, { message: 'from must be a valid date string (YYYY-MM-DD)' })
  from: string;

  @IsNotEmpty({ message: 'to date is required' })
  @IsDateString({}, { message: 'to must be a valid date string (YYYY-MM-DD)' })
  to: string;

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includePending?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  format?: string;
}
