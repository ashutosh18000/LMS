import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class ReplaceOwnerDto {
  @IsUUID('4', { message: 'New owner user ID must be a valid UUID' })
  @IsNotEmpty({ message: 'New owner user ID is required' })
  newOwnerUserId!: string;

  @IsString({ message: 'Reason must be a string' })
  @IsNotEmpty({ message: 'Reason is required' })
  reason!: string;
}
