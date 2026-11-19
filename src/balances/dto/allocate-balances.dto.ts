import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsOptional, IsUUID } from 'class-validator';

export class AllocateBalancesDto {
  @Type(() => Number)
  @IsInt({ message: 'year must be an integer' })
  year!: number;

  @IsOptional()
  @IsArray({ message: 'leaveTypeIds must be an array of UUIDs' })
  @IsUUID('4', { each: true, message: 'Each leaveTypeId must be a valid UUID' })
  leaveTypeIds?: string[];

  @IsOptional()
  @IsBoolean({ message: 'dryRun must be a boolean' })
  dryRun?: boolean;
}
