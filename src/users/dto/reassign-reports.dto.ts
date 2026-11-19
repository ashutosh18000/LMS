import { IsUUID, ValidateIf } from 'class-validator';

export class ReassignReportsDto {
  @ValidateIf((_, value) => value !== null)
  @IsUUID('4', { message: 'newManagerId must be a valid UUID or null' })
  newManagerId!: string | null;
}
