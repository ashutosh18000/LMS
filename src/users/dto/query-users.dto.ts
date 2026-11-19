import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { Role } from '@prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class QueryUsersDto extends PaginationDto {
  @IsOptional()
  @IsIn([Role.staff, Role.manager], {
    message: 'Role filter must be staff or manager',
  })
  role?: 'staff' | 'manager';

  @IsOptional()
  @IsString({ message: 'Department must be a string' })
  department?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return undefined;
  })
  @IsBoolean({ message: 'Active filter must be boolean true or false' })
  active?: boolean;

  @IsOptional()
  @IsUUID('4', { message: 'managerId must be a valid UUID' })
  managerId?: string;

  @IsOptional()
  @IsString({ message: 'Search term must be a string' })
  search?: string;
}
