import { RequestStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class QueryLeaveRequestsDto extends PaginationDto {
  @IsOptional()
  @IsEnum(RequestStatus, { message: 'status must be pending, approved, rejected, or cancelled' })
  status?: RequestStatus;

  @IsOptional()
  @IsDateString({}, { message: 'from must be a valid ISO date string (YYYY-MM-DD)' })
  from?: string;

  @IsOptional()
  @IsDateString({}, { message: 'to must be a valid ISO date string (YYYY-MM-DD)' })
  to?: string;
}
