import { IsNotEmpty, IsUUID } from 'class-validator';

export class PromoteHrAdminDto {
  @IsUUID('4', { message: 'User ID must be a valid UUID' })
  @IsNotEmpty({ message: 'User ID is required' })
  userId!: string;
}
