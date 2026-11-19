import { IsDateString, IsOptional, IsString } from 'class-validator';

export class UpdateHolidayDto {
  @IsOptional()
  @IsDateString({}, { message: 'date must be a valid ISO date string (YYYY-MM-DD)' })
  date?: string;

  @IsOptional()
  @IsString({ message: 'Holiday name must be a string' })
  name?: string;
}
