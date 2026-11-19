import { BadRequestException } from '@nestjs/common';
import { IsDateString, IsNotEmpty } from 'class-validator';
import { DateUtil } from '../utils/date.util';

export class DateRangeDto {
  @IsNotEmpty({ message: 'from date is required' })
  @IsDateString({}, { message: 'from must be a valid date string (YYYY-MM-DD)' })
  from: string;

  @IsNotEmpty({ message: 'to date is required' })
  @IsDateString({}, { message: 'to must be a valid date string (YYYY-MM-DD)' })
  to: string;
}

export function validateDateRange(from: string, to: string, maxDays = 92): void {
  if (from > to) {
    throw new BadRequestException('from date cannot be after to date');
  }
  const days = DateUtil.daysBetween(from, to);
  if (days > maxDays) {
    throw new BadRequestException(
      `Date range cannot exceed ${maxDays} days (requested ${days} days)`,
    );
  }
}
