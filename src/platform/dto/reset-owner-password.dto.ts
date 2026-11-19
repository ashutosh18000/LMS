import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ResetOwnerPasswordDto {
  @IsString({ message: 'Temporary password must be a string' })
  @MinLength(8, { message: 'Temporary password must be at least 8 characters long' })
  @IsNotEmpty({ message: 'Temporary password is required' })
  tempPassword!: string;

  @IsString({ message: 'Reason must be a string' })
  @IsNotEmpty({ message: 'Reason is required' })
  reason!: string;
}
