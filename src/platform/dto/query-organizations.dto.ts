import { IsEnum, IsOptional } from 'class-validator';
import { OrgStatus } from '@prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class QueryOrganizationsDto extends PaginationDto {
  @IsOptional()
  @IsEnum(OrgStatus, { message: 'Status must be active or suspended' })
  status?: OrgStatus;
}
