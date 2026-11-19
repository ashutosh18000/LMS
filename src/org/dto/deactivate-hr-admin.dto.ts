import { IsBoolean, IsOptional } from 'class-validator';

export class DeactivateHrAdminDto {
  @IsOptional()
  @IsBoolean({ message: 'confirmLastHr must be a boolean' })
  confirmLastHr?: boolean;
}
