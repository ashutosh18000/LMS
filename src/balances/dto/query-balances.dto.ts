import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class QueryBalancesDto extends PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'year must be an integer' })
  year?: number;

  @IsOptional()
  @IsUUID('4', { message: 'userId must be a valid UUID' })
  userId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'leaveTypeId must be a valid UUID' })
  leaveTypeId?: string;

  @IsOptional()
  @IsString({ message: 'department must be a string' })
  department?: string;
}
