import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class QueryPendingApprovalsDto extends PaginationDto {
  @IsOptional()
  @IsUUID('4', { message: 'userId must be a valid UUID' })
  userId?: string;

  @IsOptional()
  @IsString({ message: 'department must be a string' })
  department?: string;

  @IsOptional()
  @IsUUID('4', { message: 'leaveTypeId must be a valid UUID' })
  leaveTypeId?: string;

  @IsOptional()
  @IsDateString({}, { message: 'from must be a valid ISO date string (YYYY-MM-DD)' })
  from?: string;

  @IsOptional()
  @IsDateString({}, { message: 'to must be a valid ISO date string (YYYY-MM-DD)' })
  to?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean({ message: 'onlyHrAdmins must be a boolean' })
  onlyHrAdmins?: boolean;
}
