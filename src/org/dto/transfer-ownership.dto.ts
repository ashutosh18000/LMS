import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class TransferOwnershipDto {
  @IsUUID('4', { message: 'New owner user ID must be a valid UUID' })
  @IsNotEmpty({ message: 'New owner user ID is required' })
  newOwnerUserId!: string;

  @IsString({ message: 'Current password must be a string' })
  @IsNotEmpty({ message: 'Current password is required' })
  currentPassword!: string;
}
