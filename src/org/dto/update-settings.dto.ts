import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class UpdateOrgSettingsDto {
  @IsOptional()
  @IsString({ message: 'Organization name must be a string' })
  name?: string;

  @IsOptional()
  @IsString({ message: 'Timezone must be a string' })
  timezone?: string;

  @IsOptional()
  @IsInt({ message: 'Financial year start month must be an integer' })
  @Min(1, { message: 'Financial year start month must be between 1 and 12' })
  @Max(12, { message: 'Financial year start month must be between 1 and 12' })
  financialYearStartMonth?: number;

  @IsOptional()
  @IsArray({ message: 'Working days must be an array of integers' })
  @ArrayMinSize(1, { message: 'At least one working day must be specified' })
  @ArrayMaxSize(7, { message: 'Cannot specify more than 7 working days' })
  @IsInt({ each: true, message: 'Each working day must be an integer between 1 and 7' })
  @Min(1, { each: true, message: 'Working day must be between 1 (Monday) and 7 (Sunday)' })
  @Max(7, { each: true, message: 'Working day must be between 1 (Monday) and 7 (Sunday)' })
  workingDays?: number[];

  @IsOptional()
  @IsInt({ message: 'Backdate allowed days must be an integer' })
  @Min(0, { message: 'Backdate allowed days must be between 0 and 90' })
  @Max(90, { message: 'Backdate allowed days must be between 0 and 90' })
  backdateAllowedDays?: number;
}
