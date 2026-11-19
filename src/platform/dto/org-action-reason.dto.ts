import { IsNotEmpty, IsString } from 'class-validator';

export class OrgActionReasonDto {
  @IsString({ message: 'Reason must be a string' })
  @IsNotEmpty({ message: 'Reason is required' })
  reason!: string;
}
