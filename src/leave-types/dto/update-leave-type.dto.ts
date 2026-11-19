import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class UpdateLeaveTypeDto {
  @IsOptional()
  @IsString({ message: 'Leave type name must be a string' })
  name?: string;

  @IsOptional()
  @IsBoolean({ message: 'paid must be a boolean' })
  paid?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'daysPerYear must be a number' })
  @Min(0, { message: 'daysPerYear must be at least 0' })
  daysPerYear?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'monthlyLimit must be a number' })
  @Min(0, { message: 'monthlyLimit must be at least 0' })
  monthlyLimit?: number;

  @IsOptional()
  @IsBoolean({ message: 'deductsBalance must be a boolean' })
  deductsBalance?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'isWfh must be a boolean' })
  isWfh?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'halfDayAllowed must be a boolean' })
  halfDayAllowed?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'minNoticeDays must be an integer' })
  @Min(0, { message: 'minNoticeDays cannot be negative' })
  @Max(60, { message: 'minNoticeDays cannot exceed 60' })
  minNoticeDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'carryForwardMax must be a number' })
  @Min(0, { message: 'carryForwardMax cannot be negative' })
  carryForwardMax?: number;
}
