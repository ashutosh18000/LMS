import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class CreateHrAdminDto {
  @IsString({ message: 'Name must be a string' })
  @IsNotEmpty({ message: 'Name is required' })
  name!: string;

  @IsEmail({}, { message: 'Email must be a valid email address' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsNotEmpty({ message: 'Email is required' })
  email!: string;

  @IsString({ message: 'Temporary password must be a string' })
  @MinLength(8, { message: 'Temporary password must be at least 8 characters long' })
  @IsNotEmpty({ message: 'Temporary password is required' })
  tempPassword!: string;
}
