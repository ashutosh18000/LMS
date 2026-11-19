import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { Role } from '@prisma/client';

export class UpdateUserDto {
  @IsOptional()
  @IsString({ message: 'Name must be a string' })
  name?: string;

  @IsOptional()
  @IsString({ message: 'Department must be a string' })
  department?: string;

  @IsOptional()
  @IsDateString({}, { message: 'joiningDate must be a valid ISO date string' })
  joiningDate?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsUUID('4', { message: 'managerId must be a valid UUID or null' })
  managerId?: string | null;

  @IsOptional()
  @IsIn([Role.staff, Role.manager], {
    message: 'Role must be either staff or manager',
  })
  role?: 'staff' | 'manager';
}
