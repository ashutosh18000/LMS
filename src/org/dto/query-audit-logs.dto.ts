import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class QueryOrgAuditLogsDto extends PaginationDto {
  @IsOptional()
  @IsDateString({}, { message: 'from must be a valid ISO date string' })
  from?: string;

  @IsOptional()
  @IsDateString({}, { message: 'to must be a valid ISO date string' })
  to?: string;

  @IsOptional()
  @IsString({ message: 'Action must be a string' })
  action?: string;

  @IsOptional()
  @IsUUID('4', { message: 'actorId must be a valid UUID' })
  actorId?: string;
}
