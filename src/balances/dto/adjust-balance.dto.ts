import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  IsUUID,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'isNonZero', async: false })
export class IsNonZeroConstraint implements ValidatorConstraintInterface {
  validate(value: any, _args: ValidationArguments) {
    return typeof value === 'number' && value !== 0;
  }

  defaultMessage(_args: ValidationArguments) {
    return 'delta cannot be 0';
  }
}

export class AdjustBalanceDto {
  @IsUUID('4', { message: 'userId must be a valid UUID' })
  @IsNotEmpty({ message: 'userId is required' })
  userId!: string;

  @IsUUID('4', { message: 'leaveTypeId must be a valid UUID' })
  @IsNotEmpty({ message: 'leaveTypeId is required' })
  leaveTypeId!: string;

  @Type(() => Number)
  @IsInt({ message: 'year must be an integer' })
  year!: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'delta must be a number' })
  @Validate(IsNonZeroConstraint)
  delta!: number;

  @IsString({ message: 'reason must be a string' })
  @IsNotEmpty({ message: 'reason is required' })
  reason!: string;
}
