import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CancelApprovedLeaveDto {
  @IsString({ message: 'reason must be a string' })
  @IsNotEmpty({ message: 'reason is required' })
  @MaxLength(500, { message: 'reason cannot exceed 500 characters' })
  reason!: string;
}
