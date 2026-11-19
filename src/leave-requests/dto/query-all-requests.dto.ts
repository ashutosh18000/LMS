import { RequestStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class QueryAllRequestsDto extends PaginationDto {
  @IsOptional()
  @IsEnum(RequestStatus, { message: 'status must be pending, approved, rejected, or cancelled' })
  status?: RequestStatus;

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
}
