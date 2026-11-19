import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import { Role } from '@prisma/client';

export class CreateUserDto {
  @IsString({ message: 'Name must be a string' })
  @IsNotEmpty({ message: 'Name is required' })
  name!: string;

  @IsEmail({}, { message: 'Email must be a valid email address' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsNotEmpty({ message: 'Email is required' })
  email!: string;

  @IsIn([Role.staff, Role.manager], {
    message: 'Role must be either staff or manager',
  })
  @IsNotEmpty({ message: 'Role is required' })
  role!: 'staff' | 'manager';

  @IsString({ message: 'Temporary password must be a string' })
  @MinLength(8, { message: 'Temporary password must be at least 8 characters long' })
  @IsNotEmpty({ message: 'Temporary password is required' })
  tempPassword!: string;

  @IsOptional()
  @IsUUID('4', { message: 'managerId must be a valid UUID' })
  managerId?: string;

  @IsOptional()
  @IsString({ message: 'Department must be a string' })
  department?: string;

  @IsOptional()
  @IsDateString({}, { message: 'joiningDate must be a valid ISO date string' })
  joiningDate?: string;

  @IsOptional()
  @IsUUID('4', { message: 'scheduleTemplateId must be a valid UUID' })
  scheduleTemplateId?: string;
}
