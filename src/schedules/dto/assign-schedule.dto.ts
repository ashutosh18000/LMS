import { IsDateString, IsNotEmpty, IsUUID } from 'class-validator';

export class AssignScheduleDto {
  @IsUUID('4', { message: 'templateId must be a valid UUID' })
  @IsNotEmpty({ message: 'templateId is required' })
  templateId!: string;

  @IsDateString({}, { message: 'effectiveFrom must be a valid ISO date string (YYYY-MM-DD)' })
  @IsNotEmpty({ message: 'effectiveFrom is required' })
  effectiveFrom!: string;
}
