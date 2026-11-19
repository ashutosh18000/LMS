import { IsDateString, IsNotEmpty, IsString } from 'class-validator';

export class CreateHolidayDto {
  @IsDateString({}, { message: 'date must be a valid ISO date string (YYYY-MM-DD)' })
  @IsNotEmpty({ message: 'date is required' })
  date!: string;

  @IsString({ message: 'Holiday name must be a string' })
  @IsNotEmpty({ message: 'Holiday name is required' })
  name!: string;
}
