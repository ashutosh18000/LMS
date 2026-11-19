import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class CreateOrganizationDto {
  @IsString({ message: 'Organization name must be a string' })
  @IsNotEmpty({ message: 'Organization name is required' })
  orgName!: string;

  @IsString({ message: 'Owner name must be a string' })
  @IsNotEmpty({ message: 'Owner name is required' })
  ownerName!: string;

  @IsEmail({}, { message: 'Owner email must be a valid email address' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsNotEmpty({ message: 'Owner email is required' })
  ownerEmail!: string;

  @IsString({ message: 'Temporary password must be a string' })
  @MinLength(8, { message: 'Temporary password must be at least 8 characters long' })
  @IsNotEmpty({ message: 'Temporary password is required' })
  tempPassword!: string;
}
